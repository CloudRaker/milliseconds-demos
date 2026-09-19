import type { SourceDoc } from "./handbook.ts";

/** Hand-written people-operations policies for Northwind Systems. */
export const HR_POLICIES: SourceDoc[] = [
  {
    slug: "hr/time-off",
    title: "Time off",
    kind: "hr",
    sections: [
      {
        id: "vacation",
        text: "Full-time employees accrue 1.75 days of paid vacation per month, or 21 days per year, on top of public holidays. Accrual begins on your first day and you may use days before they accrue, up to five days into negative balance. Up to 10 unused days carry over into the next calendar year; anything above that is forfeited on January 31.",
      },
      {
        id: "requesting",
        text: "Request vacation in Workday at least two weeks ahead for absences of a week or longer, and at least two working days ahead for shorter absences. Managers approve within three working days and may only decline for a documented coverage reason, in which case they must propose alternative dates. Post your absence in the team calendar once approved.",
      },
      {
        id: "sick-leave",
        text: "Paid sick leave is unlimited within reason and does not draw down vacation. Notify your manager before your first meeting of the day. A doctor's note is required only for absences longer than five consecutive working days. Sick leave also covers caring for an ill child or dependent, and mental health days.",
      },
      {
        id: "holidays",
        text: "The company observes the public holidays of the country where you are employed, plus two company-wide days off: the Friday after the annual kickoff in February and the last working day before the end-of-year freeze. If a public holiday falls on a weekend, the following Monday is taken instead.",
      },
      {
        id: "bereavement",
        text: "Bereavement leave is 10 paid working days for the death of an immediate family member (partner, child, parent, sibling, grandparent) and 3 days for other close relatives or a close friend. Leave may be taken non-consecutively within six months. Additional unpaid time is granted on request; no documentation is required.",
      },
      {
        id: "jury-duty",
        text: "Jury duty and court appearances as a witness are paid for their full duration. Forward the summons to your manager and to people-ops so payroll can note the absence. Any fee the court pays you for attendance is yours to keep; the company does not offset it against salary.",
      },
    ],
  },
  {
    slug: "hr/parental",
    title: "Parental leave",
    kind: "hr",
    sections: [
      {
        id: "entitlement",
        text: "All new parents, regardless of gender or whether the child arrives by birth, adoption, or foster placement, receive 20 weeks of fully paid parental leave. Leave may be taken in up to three blocks within the first 18 months after the child's arrival. Where statutory leave in your country is more generous, the statutory entitlement applies instead.",
      },
      {
        id: "notice",
        text: "Tell your manager and people-ops at least 8 weeks before you expect to start parental leave so that coverage can be arranged, though we understand arrivals are unpredictable. People-ops will send a leave plan template; the plan is for your team's benefit and can be changed at any time.",
      },
      {
        id: "return",
        text: "Returning parents may work a reduced schedule at 80% for the first 8 weeks after leave at full pay, and may request part-time work after that under the flexible working policy. Your role, level, and compensation are protected during leave, and performance reviews covering the leave period are prorated, never marked down for absence.",
      },
    ],
  },
  {
    slug: "hr/sabbatical",
    title: "Sabbatical and extended leave",
    kind: "hr",
    sections: [
      {
        id: "sabbatical",
        text: "After five years of continuous service you are eligible for a six-week paid sabbatical, and after every subsequent five years for another. The sabbatical must be taken within two years of becoming eligible and as a single block, and it can be combined with accrued vacation. Notify your manager at least three months in advance.",
      },
      {
        id: "unpaid-leave",
        text: "Unpaid leave of up to three months may be granted for study, family care, or personal reasons at the discretion of your director. Benefits continue during unpaid leave with the company paying its share of premiums; equity vesting pauses after the first 30 days and resumes on return.",
      },
    ],
  },
  {
    slug: "hr/remote",
    title: "Remote and flexible work",
    kind: "hr",
    sections: [
      {
        id: "policy",
        text: "Northwind is remote-first: you may work from anywhere in the country where you are employed. Working from another country for more than 30 days in a rolling 12 months requires people-ops approval because of tax and employment law, and permanent relocation to another country requires a new employment contract.",
      },
      {
        id: "stipend",
        text: "Remote employees receive a one-time $1,200 home office stipend on joining for a desk, chair, and monitor, and $600 every subsequent two years for replacements. Purchases are made through the equipment portal or expensed with a receipt. Furniture over $300 remains company property and can be kept for a nominal fee when you leave.",
      },
      {
        id: "coworking",
        text: "If you prefer not to work from home, the company reimburses coworking space membership up to $350 per month with a receipt. Coworking reimbursement and the home office stipend can be combined. Hot-desking at one of the company hubs is free; book a desk in the workplace app.",
      },
      {
        id: "hours",
        text: "There are no fixed working hours, but each team agrees a daily collaboration window of at least four hours when everyone is available. Outside that window you are free to arrange your day. Meetings that include colleagues in another time zone rotate so that the inconvenient slot is not always held by the same region.",
      },
    ],
  },
  {
    slug: "hr/expenses",
    title: "Expenses and travel",
    kind: "hr",
    sections: [
      {
        id: "reimbursement",
        text: "Submit expenses in Expensify within 60 days of the purchase with an itemized receipt for anything over $25. Expenses under $75 are approved automatically; over that your manager approves; over $2,000 your director approves. Reimbursements are paid with the next payroll run after approval.",
      },
      {
        id: "corporate-card",
        text: "Employees who travel more than twice a year or who regularly buy software for their team can request a corporate card through people-ops. Card transactions still require a receipt and a business purpose in Expensify within 30 days. Personal purchases on the card, even if repaid, are a policy violation.",
      },
      {
        id: "travel-booking",
        text: "Book flights, trains, and hotels through the TravelPerk portal, which applies the travel policy automatically. Economy class is standard for flights under 6 hours; premium economy is permitted for longer flights and business class only with VP approval. Booking outside the portal is reimbursed only up to what the portal would have cost.",
      },
      {
        id: "per-diem",
        text: "When travelling you may claim actual meal costs up to $85 per day with receipts, or a flat per diem of $65 per day without receipts, but not both on the same day. Alcohol is reimbursable only at team dinners approved by a manager. Hotel rates are capped by city in the portal; conference hotels are exempt from the cap.",
      },
      {
        id: "mileage",
        text: "Using your own car for business travel is reimbursed at the government standard mileage rate in your country (currently $0.70 per mile in the US), covering fuel, wear, and insurance. Commuting to your regular hub is not reimbursable. Parking and tolls are claimed separately with receipts.",
      },
    ],
  },
  {
    slug: "hr/performance",
    title: "Performance and growth",
    kind: "hr",
    sections: [
      {
        id: "review-cycle",
        text: "Performance reviews happen twice a year, in March and September. Each cycle includes a self-review, peer feedback from three to five colleagues you nominate and your manager approves, and a manager review calibrated across the department. Ratings are Exceeds, Meets, and Below; Below triggers a written improvement plan with a 90-day check-in.",
      },
      {
        id: "promotions",
        text: "Promotions are decided in the March and September calibration sessions. To be considered, your manager submits a promotion packet showing you have operated at the next level for at least two quarters, with evidence linked to the level guide. You will hear the outcome, including the reasoning if declined, within a week of calibration.",
      },
      {
        id: "levels",
        text: "Engineering levels run from E1 (new graduate) to E7 (distinguished engineer). Managers follow a parallel M track from M1 to M5, and moving between tracks is encouraged and does not change your compensation band. Each level's expectations for scope, technical depth, and collaboration are in the public level guide.",
      },
      {
        id: "learning-budget",
        text: "Every employee has a $2,500 annual learning budget for books, courses, certifications, and conferences, plus up to five paid learning days per year. Unused budget does not roll over. Spend through the learning portal or expense it; purchases over $500 need a short note on how it relates to your role or growth plan.",
      },
      {
        id: "conferences",
        text: "Speaking at a conference is fully funded (travel, accommodation, ticket) outside your learning budget, and you get the travel days as work days rather than leave. Attending without speaking comes from the learning budget. Share what you learned in a short write-up or a team talk within a month.",
      },
    ],
  },
  {
    slug: "hr/compensation",
    title: "Compensation and benefits",
    kind: "hr",
    sections: [
      {
        id: "bands",
        text: "Each level has a published salary band for each location tier, and every employee can see the band for their level in Workday. New hires are placed between the 25th and 75th percentile of the band based on experience. Bands are refreshed every January using market data; if a refresh moves your band above your salary, you are raised to the band minimum.",
      },
      {
        id: "equity",
        text: "Equity grants vest over four years with a one-year cliff: 25% vests on your first anniversary and the remainder monthly thereafter. Refresh grants are considered at each September cycle and vest over four years with no cliff. Vested options may be exercised for up to 10 years after leaving the company.",
      },
      {
        id: "retirement",
        text: "US employees can enroll in the 401(k) plan from day one; the company matches 100% of contributions up to 4% of salary, and the match vests immediately. Employees in other countries receive the equivalent contribution to the local statutory or company pension scheme. Change your contribution rate at any time in the benefits portal.",
      },
      {
        id: "health",
        text: "Health, dental, and vision coverage begins on your first day with premiums fully paid for employees and 75% paid for dependents. Open enrollment is in November for changes effective January 1; outside that window you may change plans only after a qualifying life event such as marriage, birth, or loss of other coverage, within 30 days of the event.",
      },
      {
        id: "referral",
        text: "Employees who refer a candidate who is hired and stays 90 days receive a $3,000 referral bonus, or $5,000 for roles flagged as hard-to-fill in the careers portal. Submit referrals through the careers portal before the candidate applies; referrals of former colleagues are welcome but referrals of family members are not eligible.",
      },
    ],
  },
  {
    slug: "hr/hiring-mobility",
    title: "Hiring, relocation and immigration",
    kind: "hr",
    sections: [
      {
        id: "relocation",
        text: "Employees asked by the company to relocate receive a relocation package covering moving costs, 30 days of temporary housing, and a $5,000 settling-in allowance. Voluntary relocation to a different location tier changes your salary band effective the first of the following month and does not come with a package.",
      },
      {
        id: "visa",
        text: "The company sponsors work visas and permanent residency applications for employees and their immediate families in the US, UK, Canada, and Germany, using the immigration firm retained by people-ops. Legal fees are paid by the company. Start the conversation with people-ops at least six months before a visa expires.",
      },
      {
        id: "probation",
        text: "New employees have a six-month probation period with a structured check-in at 30, 60, and 90 days. Probation may be extended once by up to three months with a written plan. During probation either side may end employment with two weeks' notice; all benefits, including vacation accrual and equity, start on day one regardless.",
      },
      {
        id: "internal-transfer",
        text: "After 12 months in your role you may apply to any internal opening without your current manager's permission, though we encourage you to tell them. Internal candidates are interviewed first and receive a decision before external candidates are considered. Transfers keep their level, tenure, and vesting schedule.",
      },
    ],
  },
  {
    slug: "hr/conduct",
    title: "Conduct and reporting",
    kind: "hr",
    sections: [
      {
        id: "code-of-conduct",
        text: "We expect everyone to be respectful, inclusive, and honest in every interaction, including in Slack, code review, and with customers. Harassment, discrimination, and retaliation are prohibited and lead to disciplinary action up to dismissal. The full code of conduct is signed on joining and re-acknowledged each January.",
      },
      {
        id: "reporting",
        text: "Report concerns about conduct, safety, or ethics to your manager, any people-ops partner, or anonymously through the EthicsPoint hotline, which is operated by a third party and available 24/7. Reports are investigated by someone outside the reporter's management chain. Retaliation against anyone who reports in good faith is itself a dismissible offense.",
      },
      {
        id: "outside-work",
        text: "Side projects and outside employment are allowed if they do not compete with the company, use company time or equipment, or create a conflict of interest. Disclose paid outside work and board seats through the conflict-of-interest form. Open-source contributions to projects we use are encouraged and count as work time when they relate to your role.",
      },
    ],
  },
  {
    slug: "hr/leaving",
    title: "Leaving the company",
    kind: "hr",
    sections: [
      {
        id: "notice-period",
        text: "The notice period for resignation is four weeks for individual contributors up to E4 and eight weeks for E5 and above and for managers, unless your local contract specifies otherwise. Notice is given in writing to your manager and people-ops. The company may agree to a shorter period or place you on garden leave at full pay.",
      },
      {
        id: "final-pay",
        text: "Your final paycheck includes salary through your last day, payout of accrued but unused vacation up to the 10-day carryover cap, and any approved expenses submitted before your last day. Equity vested by your last day remains yours; unvested equity is forfeited. Health coverage continues to the end of the month in which you leave.",
      },
      {
        id: "equipment-return",
        text: "Return your laptop, security keys, and any corporate card within 14 days of your last day using the prepaid shipping kit people-ops sends you. You may keep home office furniture for a nominal fee and purchase your laptop at depreciated value once it has been wiped by IT. Unreturned equipment is invoiced at replacement cost.",
      },
      {
        id: "exit-interview",
        text: "People-ops invites everyone who leaves voluntarily to an exit interview in their final week. It is optional and confidential; themes are shared with leadership quarterly in aggregate without attribution. Alumni are welcome to reapply and are eligible for the referral program for former colleagues.",
      },
    ],
  },
];
