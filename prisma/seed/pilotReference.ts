import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Pilot reference data that is safe to (re)apply on an existing database: approved payment-instruction SMS templates
 * (AZ/EN/RU) and synthetic related parties with source and verification for the named demo customers plus a
 * deterministic subset of the generated portfolio. Idempotent; never touches payments, cases or history.
 */
const PAY_INSTRUCTIONS = {
  AZ: "ATB: {{customerName}}, {{loanRef}} nömrəli kredit üzrə gecikmiş {{overdueAmount}} AZN ödənişi ATB Mobile tətbiqi, istənilən ATB filialı və ya ödəniş terminalı ilə edə bilərsiniz. Ödəniş 1 iş günü ərzində əks olunur. Suallar üçün çıxarışdakı nömrəyə zəng edin.",
  EN: "ATB: {{customerName}}, the overdue amount of {{overdueAmount}} AZN on loan {{loanRef}} can be paid in the ATB Mobile app, at any ATB branch or at a payment terminal. Postings appear within 1 business day. Questions: call the number on your statement.",
  RU: "ATB: {{customerName}}, просроченную сумму {{overdueAmount}} AZN по кредиту {{loanRef}} можно оплатить в приложении ATB Mobile, в любом отделении ATB или через терминал. Зачисление в течение 1 рабочего дня. Вопросы: номер в выписке.",
} as const;

const DEMO_RELATED: Record<string, { role: "CO_BORROWER" | "GUARANTOR" | "CONTACT_PERSON"; name: string; relation: string; verified: boolean; disclosure: boolean; rules?: string }[]> = {
  "C-DEMO-001": [
    { role: "CO_BORROWER", name: "Leyla Məmmədova", relation: "həyat yoldaşı / spouse", verified: true, disclosure: true, rules: "May be contacted about the loan she co-signed; weekdays 10:00-18:00" },
    { role: "CONTACT_PERSON", name: "Elçin Məmmədov", relation: "qardaş / brother", verified: false, disclosure: false, rules: "Message only: ask the customer to call back; no debt details" },
  ],
  "C-DEMO-002": [{ role: "GUARANTOR", name: "Sergey Ivanov", relation: "zamin / guarantor", verified: true, disclosure: true, rules: "Guarantor under the contract; contact after the customer stage per policy" }],
  "C-DEMO-003": [{ role: "CONTACT_PERSON", name: "Günel Həsənova", relation: "ana / mother", verified: false, disclosure: false }],
  "C-DEMO-005": [{ role: "CO_BORROWER", name: "Nigar Əliyeva", relation: "həyat yoldaşı / spouse", verified: true, disclosure: true }],
  "C-DEMO-007": [{ role: "CONTACT_PERSON", name: "Rəşad Quliyev", relation: "iş yoldaşı / colleague", verified: false, disclosure: false, rules: "Contact person given at origination; never discuss the loan" }],
  "C-DEMO-010": [{ role: "GUARANTOR", name: "Tural Hüseynov", relation: "zamin / guarantor", verified: false, disclosure: false, rules: "Guarantor identity not yet verified: no disclosure until verified" }],
  "C-DEMO-016": [{ role: "CO_BORROWER", name: "Sabina Rzayeva", relation: "spouse", verified: true, disclosure: true }],
};

const GENERATED_NAMES = ["Aygün Kərimova", "Kamran Səfərov", "Lalə Abbasova", "Orxan Nəbiyev", "Səbinə Məlikova", "Vüsal Cəfərov", "Zaur Əhmədov", "Nərmin Qasımova"];
const RELATIONS = ["həyat yoldaşı / spouse", "qardaş / brother", "bacı / sister", "ata / father", "ana / mother", "iş yoldaşı / colleague"];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h >>> 0);
}

export async function seedPilotReference(prisma: PrismaClient) {
  const asOf = new Date("2026-10-27T05:00:00Z");
  for (const lang of ["AZ", "EN", "RU"] as const) {
    await prisma.template.upsert({
      where: { code_version_language: { code: "PAY-INSTRUCTIONS-01", version: "1.0", language: lang } },
      create: { id: `TPL-PAYINSTR-01-${lang}`, code: "PAY-INSTRUCTIONS-01", version: "1.0", kind: "SMS", language: lang, status: "ACTIVE", title: "Payment instructions (sent from the current call)", body: { text: PAY_INSTRUCTIONS[lang] } as never, variables: ["customerName", "overdueAmount", "loanRef"], channelScope: ["SMS"], effectiveFrom: new Date("2026-10-01T00:00:00Z"), approvedBy: "U-HEAD (demo)", createdBy: "U-HEAD" },
      update: {},
    });
  }
  let related = 0;
  const customers = await prisma.customer.findMany({ select: { id: true, sourceAsOf: true } });
  for (const c of customers) {
    const defs = DEMO_RELATED[c.id] ?? (!c.id.startsWith("C-DEMO") && hash(c.id) % 4 === 0 ? [{ role: hash(c.id) % 3 === 0 ? ("GUARANTOR" as const) : ("CONTACT_PERSON" as const), name: GENERATED_NAMES[hash(c.id) % GENERATED_NAMES.length], relation: RELATIONS[hash(`${c.id}r`) % RELATIONS.length], verified: hash(`${c.id}v`) % 2 === 0, disclosure: false }] : []);
    for (const d of defs) {
      const existing = await prisma.relatedParty.findFirst({ where: { customerId: c.id, role: d.role, displayName: d.name } });
      if (existing) continue;
      const digits = String(hash(`${c.id}${d.name}`) % 100).padStart(2, "0");
      await prisma.relatedParty.create({ data: { customerId: c.id, role: d.role, displayName: d.name, relation: d.relation, phoneMasked: `+994 ** *** ** ${digits}`, verification: d.verified ? "VERIFIED" : "UNVERIFIED", disclosureAllowed: d.disclosure && d.verified, contactRules: d.rules ?? (d.disclosure ? null : "Message only; no loan details"), sourceSystem: "CUSTOMER_MASTER_DEMO", sourceAsOf: c.sourceAsOf ?? asOf } });
      related++;
    }
  }
  return { templates: 3, relatedPartiesCreated: related };
}
