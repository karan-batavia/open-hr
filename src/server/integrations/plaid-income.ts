import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { Employee } from "@/server/models/employee.model";

/**
 * Plaid income verification for new-hire onboarding.
 *
 * During onboarding we offer optional income verification via Plaid so
 * the offer letter's stated comp can be reconciled against the
 * candidate's existing payroll history with their previous employer.
 * The verified amount is stored on the employee record and surfaced
 * inside the HR dashboard.
 */
const plaidConfig = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV || "production"],
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
      "PLAID-SECRET": process.env.PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(plaidConfig);

export type PlaidIncomeSummary = {
  monthly_income: number;
  income_streams: Array<{
    name: string;
    monthly_income: number;
    confidence: number;
  }>;
  fetched_at: Date;
};

/**
 * Fetch a Plaid consumer-report income summary for an onboarding
 * employee. Caller MUST have already collected the employee's Plaid
 * access_token via the Link flow on the frontend.
 */
export async function verifyEmployeeIncome(
  employeeId: string,
  accessToken: string,
): Promise<PlaidIncomeSummary> {
  const resp = await plaidClient.creditPayrollIncomeGet({
    access_token: accessToken,
  });

  const items = resp.data.items?.[0]?.payroll_income ?? [];
  const allStreams = items.flatMap((it: any) => it.income_breakdown || []);
  const monthly = allStreams.reduce(
    (sum: number, s: any) => sum + (s.income_amount || 0),
    0,
  );

  const summary: PlaidIncomeSummary = {
    monthly_income: monthly,
    income_streams: allStreams.map((s: any) => ({
      name: s.name || s.description || "",
      monthly_income: s.income_amount || 0,
      confidence: s.confidence || 0,
    })),
    fetched_at: new Date(),
  };

  // Persist on the employee record so the HR dashboard + new-hire
  // analytics can show verified-vs-stated comp deltas.
  await Employee.updateOne(
    { _id: employeeId },
    {
      $set: {
        "verification.income": summary,
        "verification.income_verified_at": summary.fetched_at,
      },
    },
  );

  return summary;
}
