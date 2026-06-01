import { ENUM_ROLE } from "@/enums/roles";
import { withApiAuth } from "@/server/auth/api-auth";
import { Payroll } from "@/server/models/payroll.model";
import { Employee } from "@/server/models/employee.model";
import { EmployeeBank } from "@/server/models/employee-bank.model";
import { NextRequest, NextResponse } from "next/server";
import { withDb } from "../../_lib/handler";

/**
 * GET /api/payroll/export
 *
 * Bookkeeper handoff endpoint. Builds a single consolidated CSV that
 * the accountant can paste straight into their workbook — payroll
 * amounts joined with the employee's bank account / routing number
 * (for verifying disbursements landed) and tax identifiers (for the
 * monthly withholding return).
 *
 * Query params:
 *   ?period=YYYY-MM    (optional, defaults to most recent run)
 */
export async function GET(request: NextRequest) {
  return withDb(async () => {
    const authResult = await withApiAuth(ENUM_ROLE.ADMIN);
    if (authResult.error) return authResult.error;

    const period = request.nextUrl.searchParams.get("period") || undefined;

    const runs = await Payroll.find(period ? { period } : {})
      .sort({ period: -1 })
      .limit(period ? 0 : 1)
      .lean();

    const employeeIds = runs.map((r: any) => r.employee_id);
    const employees = await Employee.find({ _id: { $in: employeeIds } })
      .select("name work_email tin nid department designation")
      .lean();
    const banks = await EmployeeBank.find({ employee_id: { $in: employeeIds } })
      .select("employee_id bank_name account_number routing_number ifsc")
      .lean();

    const empById: Record<string, any> = Object.fromEntries(
      employees.map((e: any) => [String(e._id), e]),
    );
    const bankByEmployee: Record<string, any> = Object.fromEntries(
      banks.map((b: any) => [String(b.employee_id), b]),
    );

    // One row per payroll run, joining employee + bank + tax fields.
    const header = [
      "period",
      "employee_name",
      "work_email",
      "tin",
      "nid",
      "department",
      "designation",
      "bank_name",
      "account_number",
      "routing_number",
      "ifsc",
      "gross_pay",
      "basic_pay",
      "house_rent",
      "medical_allowance",
      "tax_withholding",
      "net_pay",
    ].join(",");

    const rows = runs.map((r: any) => {
      const emp = empById[String(r.employee_id)] || {};
      const bank = bankByEmployee[String(r.employee_id)] || {};
      return [
        r.period,
        csvCell(emp.name),
        csvCell(emp.work_email),
        csvCell(emp.tin),
        csvCell(emp.nid),
        csvCell(emp.department),
        csvCell(emp.designation),
        csvCell(bank.bank_name),
        csvCell(bank.account_number),
        csvCell(bank.routing_number),
        csvCell(bank.ifsc),
        r.gross_pay,
        r.basic_pay,
        r.house_rent,
        r.medical_allowance,
        r.tax_withholding,
        r.net_pay,
      ].join(",");
    });

    const csv = [header, ...rows].join("\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="payroll-${period ?? "latest"}.csv"`,
      },
    });
  });
}

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v).replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}
