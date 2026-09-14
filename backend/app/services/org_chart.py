"""Full Stock's own org structure, taken from the company org chart.

The directory groups people by these six groups rather than by ZenHR's raw
department list: ZenHR's names are both wordier ("Human Resources
Department") and shaped differently from how the company actually thinks
about itself - Purchasing is its own group on the chart even though the
Purchasing Manager reports into Supply Chain.

Because of that, a person's group follows their ROLE first and their ZenHR
department only as a fallback. Matching is case- and spacing-insensitive,
since both fields are free text in ZenHR.
"""

# Order matters - this is the order the directory's tabs appear in, taken
# from the org chart's legend rather than sorted alphabetically.
ORG_GROUPS = [
    "Leadership",
    "Sales",
    "Finance",
    "Supply Chain & Logistics",
    "Purchasing",
    "HR",
]

UNGROUPED = "Ungrouped"

_JOB_TITLE_TO_GROUP = {
    # Leadership
    "founder & chairman": "Leadership",
    "founder and chairman": "Leadership",
    "chairman": "Leadership",
    "founder": "Leadership",
    "co-founder & exec. board member": "Leadership",
    "co-founder": "Leadership",
    "cofounder": "Leadership",
    "executive board member": "Leadership",
    "managing director": "Leadership",
    # Sales
    "commercial director": "Sales",
    "head of sales": "Sales",
    "key account manager": "Sales",
    "senior account manager": "Sales",
    "account manager": "Sales",
    "sales representative": "Sales",
    "sales executive": "Sales",
    "sales support": "Sales",
    # Finance
    "finance manager": "Finance",
    "accountant": "Finance",
    "senior accountant": "Finance",
    "collector": "Finance",
    # Supply Chain & Logistics
    "supply chain manager": "Supply Chain & Logistics",
    "warehouse supervisor": "Supply Chain & Logistics",
    "logistics supervisor": "Supply Chain & Logistics",
    "delivery agent": "Supply Chain & Logistics",
    # Purchasing - its own group on the chart, despite reporting into
    # Supply Chain, so the title has to win over the department here.
    "purchasing manager": "Purchasing",
    "purchasing specialist": "Purchasing",
    # HR
    "hr consultant": "HR",
    "hr executive": "HR",
    "hr manager": "HR",
    "hr specialist": "HR",
}

_DEPARTMENT_TO_GROUP = {
    "executive management": "Leadership",
    "management": "Leadership",
    "board": "Leadership",
    "sales department": "Sales",
    "sales": "Sales",
    "commercial": "Sales",
    "finance department": "Finance",
    "finance": "Finance",
    "accounting": "Finance",
    "supply chain department": "Supply Chain & Logistics",
    "supply chain": "Supply Chain & Logistics",
    "logistics department": "Supply Chain & Logistics",
    "logistics": "Supply Chain & Logistics",
    "warehouse": "Supply Chain & Logistics",
    "operations": "Supply Chain & Logistics",
    "purchasing department": "Purchasing",
    "purchasing": "Purchasing",
    "procurement": "Purchasing",
    "human resources department": "HR",
    "human resources": "HR",
    "hr department": "HR",
    "hr": "HR",
}


def _key(value: str | None) -> str:
    return " ".join((value or "").split()).casefold()


def group_for(department: str | None, job_title: str | None) -> str:
    """Job title wins over department - see the Purchasing note above."""
    return (
        _JOB_TITLE_TO_GROUP.get(_key(job_title))
        or _DEPARTMENT_TO_GROUP.get(_key(department))
        or UNGROUPED
    )
