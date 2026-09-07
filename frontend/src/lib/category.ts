import type { EmployeeCategory } from "../api/types";

export const CATEGORY_LABEL: Record<EmployeeCategory, string> = {
  MANAGEMENT: "Management",
  SALES: "Sales",
  COLLECTOR: "Collector",
  DELIVERY_AGENT: "Delivery Agent",
  SALES_SUPPORT: "Sales Support",
  EXCLUDED: "Excluded",
  UNASSIGNED: "Unassigned",
};

export function primaryMetricLabel(category: EmployeeCategory): string {
  switch (category) {
    case "MANAGEMENT":
      return "Hours";
    case "SALES":
    case "COLLECTOR":
      return "Visits";
    case "DELIVERY_AGENT":
      return "Hours + Visits";
    default:
      return "";
  }
}
