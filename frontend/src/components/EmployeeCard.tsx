import { Link } from "react-router-dom";
import type { EmployeeCard as EmployeeCardType } from "../api/types";
import Avatar from "./Avatar";
import { CATEGORY_LABEL } from "../lib/category";

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-sm font-semibold text-ink">{value}</div>
      <div className="text-[11px] text-muted leading-tight">{label}</div>
    </div>
  );
}

export default function EmployeeCard({ employee }: { employee: EmployeeCardType }) {
  const showHours = employee.category === "MANAGEMENT" || employee.category === "DELIVERY_AGENT";
  const showVisits =
    employee.category === "SALES" || employee.category === "COLLECTOR" || employee.category === "DELIVERY_AGENT";

  return (
    <Link
      to={`/employees/${employee.id}`}
      className="group bg-white border border-line rounded-xl p-5 hover:shadow-md hover:-translate-y-0.5 transition-all flex flex-col gap-4"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Avatar name={employee.display_name} photoUrl={employee.photo_url} size={48} />
          <div>
            <div className="font-medium text-sm leading-tight">{employee.display_name}</div>
            <div className="text-xs text-muted mt-0.5">{employee.job_title ?? CATEGORY_LABEL[employee.category]}</div>
          </div>
        </div>
        {employee.onboarding_status === "PENDING_CONFIRMATION" && (
          <span className="text-[10px] uppercase tracking-wide bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full whitespace-nowrap">
            New
          </span>
        )}
      </div>

      <div className="flex items-center gap-6 pt-3 border-t border-line/70">
        {showHours && <MiniStat label="Hours" value={employee.period_hours ?? "—"} />}
        {showVisits && <MiniStat label="Visits" value={employee.period_visits ?? "—"} />}
        <MiniStat
          label="Days present"
          value={
            employee.period_days_present != null && employee.period_days_expected != null
              ? `${employee.period_days_present}/${employee.period_days_expected}`
              : "—"
          }
        />
      </div>
    </Link>
  );
}
