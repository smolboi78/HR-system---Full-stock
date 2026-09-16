"""Full Stock's own org structure, taken from the company org chart.

The directory groups people by these four departments rather than by
ZenHR's raw department list: ZenHR's names are both wordier ("Human
Resources Department") and shaped differently from how the company actually
thinks about itself - HR sits under Executive Management here, and
Purchasing is a section of Supply Chain even though ZenHR calls it a
department of its own.

Because of that, a person's placement follows their ROLE first and their
ZenHR department only as a fallback. Matching is case- and
spacing-insensitive, since both fields are free text in ZenHR.
"""

# Order matters - this is the order the directory's tabs appear in, taken
# from the org chart rather than sorted alphabetically. Commercial is
# deliberately flat: it has no sections, so it renders no sub-tabs.
ORG_STRUCTURE: list[tuple[str, list[str]]] = [
    ("Executive Management", ["Managers / Directors", "Human Resources"]),
    ("Finance Department", ["Accounting", "Collection"]),
    ("Supply Chain", ["Warehouse", "Logistics", "Purchasing"]),
    ("Commercial", []),
]

ORG_GROUPS = [name for name, _ in ORG_STRUCTURE]
SECTIONS_BY_GROUP = {name: sections for name, sections in ORG_STRUCTURE}

UNGROUPED = "Ungrouped"
# Someone whose department is known but whose role matches no section - they
# belong on the department tab, just not under any of its sections.
UNSECTIONED = "Other"

_DIRECTORS = ("Executive Management", "Managers / Directors")
_HR = ("Executive Management", "Human Resources")
_ACCOUNTING = ("Finance Department", "Accounting")
_COLLECTION = ("Finance Department", "Collection")
_WAREHOUSE = ("Supply Chain", "Warehouse")
_LOGISTICS = ("Supply Chain", "Logistics")
_PURCHASING = ("Supply Chain", "Purchasing")
_COMMERCIAL = ("Commercial", None)

_JOB_TITLE_TO_PLACE: dict[str, tuple[str, str | None]] = {
    # Executive Management - Managers / Directors
    "founder & chairman": _DIRECTORS,
    "founder and chairman": _DIRECTORS,
    "chairman": _DIRECTORS,
    "founder": _DIRECTORS,
    "co-founder & exec. board member": _DIRECTORS,
    "co-founder": _DIRECTORS,
    "cofounder": _DIRECTORS,
    "executive board member": _DIRECTORS,
    "managing director": _DIRECTORS,
    "general manager": _DIRECTORS,
    "operations manager": _DIRECTORS,
    "area manager": _DIRECTORS,
    "branch manager": _DIRECTORS,
    # Director-level despite the name, so it outranks the Supply Chain
    # department fallback below.
    "supply chain manager": _DIRECTORS,
    # Executive Management - Human Resources
    "hr consultant": _HR,
    "hr executive": _HR,
    "hr manager": _HR,
    "hr specialist": _HR,
    # Finance Department
    "finance manager": _ACCOUNTING,
    "accountant": _ACCOUNTING,
    "senior accountant": _ACCOUNTING,
    "collector": _COLLECTION,
    # Supply Chain
    "warehouse supervisor": _WAREHOUSE,
    "warehouse keeper": _WAREHOUSE,
    "logistics supervisor": _LOGISTICS,
    "delivery agent": _LOGISTICS,
    "purchasing manager": _PURCHASING,
    "purchasing specialist": _PURCHASING,
    # Commercial - flat, no sections
    "commercial director": _COMMERCIAL,
    "head of sales": _COMMERCIAL,
    "key account manager": _COMMERCIAL,
    "senior account manager": _COMMERCIAL,
    "account manager": _COMMERCIAL,
    "sales representative": _COMMERCIAL,
    "sales executive": _COMMERCIAL,
    "sales support": _COMMERCIAL,
}

_DEPARTMENT_TO_PLACE: dict[str, tuple[str, str | None]] = {
    "executive management": ("Executive Management", None),
    "management": ("Executive Management", None),
    "board": _DIRECTORS,
    "human resources department": _HR,
    "human resources": _HR,
    "hr department": _HR,
    "hr": _HR,
    "finance department": ("Finance Department", None),
    "finance": ("Finance Department", None),
    "accounting": _ACCOUNTING,
    "collection": _COLLECTION,
    "supply chain department": ("Supply Chain", None),
    "supply chain": ("Supply Chain", None),
    "logistics department": _LOGISTICS,
    "logistics": _LOGISTICS,
    "warehouse": _WAREHOUSE,
    "operations": ("Supply Chain", None),
    "purchasing department": _PURCHASING,
    "purchasing": _PURCHASING,
    "procurement": _PURCHASING,
    "sales department": _COMMERCIAL,
    "sales": _COMMERCIAL,
    "commercial": _COMMERCIAL,
}

# Groups from the previous six-tab structure. An org_group_override stored
# under an old name would otherwise point at a tab that no longer exists,
# stranding that person on a dead tab, so old values are read forward
# instead of needing a data migration.
_LEGACY_GROUPS = {
    "Leadership": "Executive Management",
    "Sales": "Commercial",
    "Finance": "Finance Department",
    "Supply Chain & Logistics": "Supply Chain",
    "Purchasing": "Supply Chain",
    "HR": "Executive Management",
}


def _key(value: str | None) -> str:
    return " ".join((value or "").split()).casefold()


def place_for(department: str | None, job_title: str | None) -> tuple[str, str | None]:
    """Job title wins over department - see the Supply Chain Manager note."""
    return (
        _JOB_TITLE_TO_PLACE.get(_key(job_title))
        or _DEPARTMENT_TO_PLACE.get(_key(department))
        or (UNGROUPED, None)
    )


def group_for(department: str | None, job_title: str | None) -> str:
    return place_for(department, job_title)[0]


def group_for_employee(employee) -> str:
    """The department an employee appears under. An admin's explicit group
    override wins outright; otherwise it's derived from their corrected job
    title, so fixing just the title in Settings usually moves someone to the
    right tab without touching the group at all."""
    override = employee.org_group_override
    if override:
        return _LEGACY_GROUPS.get(override, override)
    return group_for(employee.department, employee.effective_job_title)


def section_for_employee(employee) -> str | None:
    """The sub-tab within that department, or None when the department has no
    sections at all (Commercial). Someone an override moved to a department
    their role doesn't belong to has no meaningful section, so they fall to
    the department's trailing "Other" sub-tab rather than a wrong one."""
    group = group_for_employee(employee)
    if not SECTIONS_BY_GROUP.get(group):
        return None

    derived_group, section = place_for(employee.department, employee.effective_job_title)
    if section and derived_group == group:
        return section
    return UNSECTIONED
