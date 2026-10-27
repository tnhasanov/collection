import type { PrismaClient } from "@/generated/prisma/client";
import { hashPassword } from "@/server/auth/password";
import { ensureDefaultSettings } from "@/server/modules/settings/settingsService";
import { PROMETEIA_DRAFT_MODEL } from "@/server/modules/decisions/prometeiaDraftModel";
import { DEMO_CONTACT_POLICY } from "@/server/modules/contactPolicy/types";
import { DEMO_SEED_INSTANT } from "@/server/clock";

export const DEMO_PASSWORD = "demo1234";

export const USERS = [
  { id: "U-AGENT-A", username: "agent.a", displayName: "Senior Agent A", role: "SENIOR_AGENT", team: "Senior soft collections", languages: ["AZ", "RU"], seniority: "SENIOR", extension: "1042" },
  { id: "U-AGENT-B", username: "agent.b", displayName: "Senior Agent B", role: "SENIOR_AGENT", team: "Senior soft collections", languages: ["AZ", "EN"], seniority: "SENIOR", extension: "1043" },
  { id: "U-AGENT-C", username: "agent.c", displayName: "Agent C", role: "AGENT", team: "Regular soft collections", languages: ["AZ"], seniority: "REGULAR", extension: "1051" },
  { id: "U-AGENT-D", username: "agent.d", displayName: "Agent D", role: "AGENT", team: "Regular soft collections", languages: ["AZ", "RU"], seniority: "REGULAR", extension: "1052" },
  { id: "U-AGENT-E", username: "agent.e", displayName: "Agent E", role: "AGENT", team: "Regular soft collections", languages: ["AZ"], seniority: "REGULAR", extension: "1053" },
  { id: "U-AGENT-F", username: "agent.f", displayName: "Agent F", role: "AGENT", team: "Regular soft collections", languages: ["AZ", "EN"], seniority: "REGULAR", extension: "1054" },
  { id: "U-LEAD", username: "lead", displayName: "Demo Team Lead", role: "TEAM_LEAD", team: "Collections management", languages: ["AZ", "EN", "RU"] },
  { id: "U-HEAD", username: "head", displayName: "Demo Collections Head", role: "COLLECTIONS_HEAD", team: "Collections management", languages: ["AZ", "EN"] },
  { id: "U-RISK", username: "risk", displayName: "Demo Risk Analyst", role: "RISK_ANALYST", team: "Risk", languages: ["EN", "AZ"] },
  { id: "U-MODEL", username: "modelmaker", displayName: "Demo Model Maker", role: "MODEL_MAKER", team: "Risk", languages: ["EN"] },
  { id: "U-APPROVER", username: "approver", displayName: "Demo Independent Approver", role: "INDEPENDENT_APPROVER", team: "Risk", languages: ["EN", "AZ"] },
  { id: "U-INTEGRATION", username: "integrator", displayName: "Demo Integration Operator", role: "INTEGRATION_OPERATOR", team: "Technology", languages: ["EN"] },
  { id: "U-AUDITOR", username: "auditor", displayName: "Demo Auditor", role: "AUDITOR", team: "Compliance", languages: ["EN", "AZ"] },
  { id: "U-ADMIN", username: "admin", displayName: "Demo Administrator", role: "ADMIN", team: "Technology", languages: ["EN"] },
  { id: "U-SVC-CORE", username: "svc.core-feed", displayName: "Core feed service account", role: "SERVICE", team: "Technology", languages: ["EN"], service: true },
] as const;

export async function seedReference(prisma: PrismaClient) {
  await ensureDefaultSettings(prisma);

  const teams = [
    { id: "T-SENIOR", name: "Senior soft collections", kind: "SENIOR" },
    { id: "T-REGULAR", name: "Regular soft collections", kind: "REGULAR" },
    { id: "T-MGMT", name: "Collections management", kind: "MANAGEMENT" },
    { id: "T-SUPPORT", name: "Repayment support", kind: "SUPPORT" },
    { id: "T-RECOVERY", name: "Late collection & recovery", kind: "RECOVERY" },
    { id: "T-RISK", name: "Risk", kind: "MANAGEMENT" },
    { id: "T-TECH", name: "Technology", kind: "MANAGEMENT" },
    { id: "T-COMPLIANCE", name: "Compliance", kind: "MANAGEMENT" },
  ] as const;
  for (const t of teams) await prisma.team.upsert({ where: { id: t.id }, create: { id: t.id, name: t.name, kind: t.kind, branch: "HQ" }, update: {} });
  const teamByName = new Map(teams.map((t) => [t.name, t.id]));

  const passwordHash = hashPassword(DEMO_PASSWORD);
  for (const u of USERS) {
    await prisma.user.upsert({
      where: { id: u.id },
      create: {
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        role: u.role,
        teamId: teamByName.get(u.team) ?? null,
        languages: [...u.languages],
        skills: "seniority" in u ? (u.seniority === "SENIOR" ? ["VOICE", "SENIOR", "COMPLEX_CASES"] : ["VOICE"]) : [],
        passwordHash: "service" in u ? null : passwordHash,
        isServiceAccount: "service" in u,
        email: `${u.username}@demo.atb.local`,
      },
      update: { passwordHash: "service" in u ? null : passwordHash },
    });
    if ("seniority" in u) {
      await prisma.agentProfile.upsert({
        where: { userId: u.id },
        create: { userId: u.id, seniority: u.seniority, extension: u.extension, providerAgentRef: `mock-agent-${u.extension}`, campaignCodes: ["SOFT_COLLECTIONS_VOICE"], shiftStart: "09:00", shiftEnd: "18:00", manualDialAllowed: u.seniority === "SENIOR" },
        update: {},
      });
    }
  }

  // Model versions: demo-activated DRAFT transcription + a candidate awaiting independent approval.
  const activeModel = await prisma.modelVersion.upsert({
    where: { modelCode_version: { modelCode: PROMETEIA_DRAFT_MODEL.modelCode, version: PROMETEIA_DRAFT_MODEL.version } },
    create: {
      id: "MV-DRAFT-P10",
      provider: "Prometeia",
      modelCode: PROMETEIA_DRAFT_MODEL.modelCode,
      version: PROMETEIA_DRAFT_MODEL.version,
      checksum: "sha256:demo-transcription-p10",
      status: "ACTIVE",
      source: PROMETEIA_DRAFT_MODEL.provenance,
      owner: "Model owner (unassigned) / demo",
      observationFrequency: "Monthly customer-level observation; daily operational scoring reuses the latest complete monthly snapshot",
      targetPopulation: PROMETEIA_DRAFT_MODEL.population,
      targetEvent: PROMETEIA_DRAFT_MODEL.targetEvent,
      horizon: PROMETEIA_DRAFT_MODEL.horizon,
      rulesJson: PROMETEIA_DRAFT_MODEL as never,
      featureDictionary: PROMETEIA_DRAFT_MODEL.features as never,
      unresolvedIssues: PROMETEIA_DRAFT_MODEL.unresolvedIssues as never,
      approvedBy: "DEMO ACTIVATION (synthetic) - not a bank approval",
      approvedAt: DEMO_SEED_INSTANT,
      activatedAt: DEMO_SEED_INSTANT,
      validFrom: new Date("2026-10-01T00:00:00Z"),
      validTo: new Date("2027-03-31T00:00:00Z"),
      notes: "DRAFT transcription of the page 10 rule table, demo-activated so the synthetic demo can run. Production activation requires a signed executable artifact with golden cases and independent approval.",
    },
    update: {},
  });
  await prisma.modelVersion.upsert({
    where: { modelCode_version: { modelCode: PROMETEIA_DRAFT_MODEL.modelCode, version: "CANDIDATE-2026-11" } },
    create: {
      id: "MV-CANDIDATE",
      provider: "Prometeia",
      modelCode: PROMETEIA_DRAFT_MODEL.modelCode,
      version: "CANDIDATE-2026-11",
      checksum: "sha256:candidate-awaiting-signed-artifact",
      status: "TESTED",
      source: "Candidate re-import pending provider confirmation of the Class 7 leaf",
      owner: "Demo Model Maker",
      observationFrequency: "Monthly",
      targetPopulation: PROMETEIA_DRAFT_MODEL.population,
      targetEvent: PROMETEIA_DRAFT_MODEL.targetEvent,
      horizon: PROMETEIA_DRAFT_MODEL.horizon,
      rulesJson: PROMETEIA_DRAFT_MODEL as never,
      featureDictionary: PROMETEIA_DRAFT_MODEL.features as never,
      unresolvedIssues: PROMETEIA_DRAFT_MODEL.unresolvedIssues as never,
      notes: "Golden cases pass on the draft rules; activation blocked until the provider confirms the executable artifact.",
    },
    update: {},
  });

  const strategyConfig = {
    population: { portfolio: "EARLY_ARREARS", dpdBands: ["DPD_1_3", "DPD_4_10", "DPD_11_16", "DPD_17_23", "DPD_24_30"], laterStage: "SEPARATE_QUEUE" },
    probability: { DPD_1_3: "DEMO_ONLY_1_3_RULE", DPD_4_10: "DRAFT_TREE_4_10", DPD_11_30: "DRAFT_ROLL_RATE_11_30", DPD_31_PLUS: "NONE" },
    exposure: { definition: "SUM_ELIGIBLE_ACTIVE_CASH_LOAN_PRINCIPAL_OUTSTANDING_PER_CUSTOMER", currency: "AZN" },
    actionBucket: { method: "DECILE_AT_DAILY_SNAPSHOT", tieHandling: "IDENTICAL_ERA_SAME_BUCKET_LOWER" },
    treatment: {
      "1-4": { recommended: "SMS / email", effective: "SMS / self-cure", assignment: "No routine agent call" },
      "5-6": { recommended: "Robo call + digital", effective: "SMS fallback", assignment: "No routine agent call", reason: "IVR unavailable" },
      "7": { recommended: "Robo/SMS + selective call", effective: "SMS + call if capacity", assignment: "Regular agent if spare" },
      "8-9": { recommended: "Agent call + digital", effective: "Structured agent call", assignment: "Regular queue / priority" },
      "10": { recommended: "Senior agent call", effective: "Senior call", assignment: "Senior-only queue; flag overflow" },
    },
    channels: { sms: true, call: true, ivr: false, email: false },
    contactPolicyVersion: "CONTACT_POLICY/DEMO-01",
    capacity: { seniorAgents: 2, regularAgents: 4, successfulContactsPerAgentDay: 80 },
    fallback: { unscored: "MANUAL_REVIEW", laterStage: "LATER_STAGE_REVIEW", ivrUnavailable: "SMS_FALLBACK" },
    dispatch: { mode: "PROGRESSIVE_MOCK_DIALER", oneReservationPerCustomer: true, oneVoiceInteractionPerAgent: true },
  };
  const activeStrategy = await prisma.strategyVersion.upsert({
    where: { code_version: { code: "EARLY_ARREARS_SOFT", version: "DEMO-01" } },
    create: { id: "SV-DEMO-01", code: "EARLY_ARREARS_SOFT", version: "DEMO-01", status: "ACTIVE", configJson: strategyConfig as never, createdBy: "U-RISK", approvedBy: "U-APPROVER", activatedAt: DEMO_SEED_INSTANT, notes: "Demo activation of the source treatment design. Not production approved." },
    update: {},
  });
  await prisma.strategyVersion.upsert({
    where: { code_version: { code: "EARLY_ARREARS_SOFT", version: "2026.11-draft" } },
    create: { id: "SV-DRAFT-2026-11", code: "EARLY_ARREARS_SOFT", version: "2026.11-draft", status: "DRAFT", configJson: { ...strategyConfig, treatment: { ...strategyConfig.treatment, "7": { recommended: "Robo/SMS + selective call", effective: "Regular agent call", assignment: "Regular queue" } } } as never, createdBy: "U-RISK", notes: "Draft: bucket 7 to regular calls. Requires dry simulation and independent approval before activation." },
    update: {},
  });
  await prisma.contactPolicyVersion.upsert({
    where: { code_version: { code: DEMO_CONTACT_POLICY.code, version: DEMO_CONTACT_POLICY.version } },
    create: { id: "CP-DEMO-01", code: DEMO_CONTACT_POLICY.code, version: DEMO_CONTACT_POLICY.version, status: "ACTIVE", configJson: DEMO_CONTACT_POLICY as never, createdBy: "U-HEAD", approvedBy: "U-APPROVER", activatedAt: DEMO_SEED_INSTANT, notes: "120-hour reading of the source's minimum five-day cooldown; other values are demo assumptions." },
    update: {},
  });

  // Templates: agent scripts (EN/AZ/RU), third-party script, SMS reminders, PTP reminder.
  const scriptBody = (lang: "EN" | "AZ" | "RU") => ({
    steps: [
      { key: "verify", title: { EN: "Opening and right-party verification", AZ: "Giriş və şəxsiyyətin təsdiqi", RU: "Приветствие и подтверждение личности" }[lang], text: { EN: "Good day, this is {{agentName}} from ATB. May I speak with {{customerName}}? For security, please confirm your date of birth or the last digits of your ID.", AZ: "Salam, mən ATB-dən {{agentName}}. {{customerName}} ilə danışa bilərəm? Təhlükəsizlik üçün doğum tarixinizi və ya şəxsiyyət vəsiqənizin son rəqəmlərini təsdiqləyin.", RU: "Здравствуйте, это {{agentName}} из ATB. Могу я поговорить с {{customerName}}? Для безопасности подтвердите дату рождения или последние цифры удостоверения." }[lang], requires: "NONE" },
      { key: "explain", title: { EN: "Explain the overdue installment", AZ: "Gecikmiş ödənişi izah et", RU: "Объяснить просроченный платёж" }[lang], text: { EN: "Our records show that the installment of {{overdueAmount}} AZN due on {{oldestDueDate}} remains unpaid ({{dpd}} days). Can you help me understand what happened and what payment would be manageable?", AZ: "Qeydlərimizə görə {{oldestDueDate}} tarixində ödənilməli {{overdueAmount}} AZN məbləğində ödəniş hələ də ödənilməyib ({{dpd}} gün). Nə baş verdiyini və hansı ödənişin mümkün olduğunu izah edə bilərsiniz?", RU: "По нашим данным платёж {{overdueAmount}} AZN со сроком {{oldestDueDate}} остаётся неоплаченным ({{dpd}} дней). Подскажите, что произошло и какой платёж возможен?" }[lang], requires: "RPC_VERIFIED" },
      { key: "reason", title: { EN: "Establish the reason", AZ: "Səbəbi müəyyən et", RU: "Выяснить причину" }[lang], text: { EN: "Select the reason the customer gives. Do not record sensitive details beyond what the policy requires.", AZ: "Müştərinin bildirdiyi səbəbi seçin. Siyasətin tələb etdiyindən artıq həssas məlumat qeyd etməyin.", RU: "Выберите причину, названную клиентом. Не фиксируйте лишние чувствительные детали." }[lang], requires: "RPC_VERIFIED" },
      { key: "agree", title: { EN: "Agree the next step", AZ: "Növbəti addımı razılaşdır", RU: "Согласовать следующий шаг" }[lang], text: { EN: "Payment timing → promise to pay or callback. Already paid → reconcile the claimed payment. Affordability difficulty → repayment support referral. Debt disputed → dispute workflow.", AZ: "Ödəniş vaxtı → ödəniş vədi və ya geri zəng. Artıq ödənilib → iddia edilən ödənişi tutuşdur. Ödəmə çətinliyi → ödəniş dəstəyinə yönləndir. Borc mübahisəlidir → mübahisə prosesi.", RU: "Сроки оплаты → обещание или обратный звонок. Уже оплачено → сверка заявленного платежа. Трудности → направление в поддержку. Спор по долгу → процесс спора." }[lang], requires: "RPC_VERIFIED" },
      { key: "confirm", title: { EN: "Confirm the commitment", AZ: "Öhdəliyi təsdiqlə", RU: "Подтвердить обязательство" }[lang], text: { EN: "Please confirm: you will pay {{promiseAmount}} AZN by {{promiseDate}}. This does not change your contract. A reminder may be sent before the date.", AZ: "Təsdiqləyin: {{promiseDate}} tarixinədək {{promiseAmount}} AZN ödəyəcəksiniz. Bu, müqavilənizi dəyişmir. Tarixdən əvvəl xatırlatma göndərilə bilər.", RU: "Подтвердите: вы оплатите {{promiseAmount}} AZN до {{promiseDate}}. Это не меняет договор. Напоминание может быть отправлено заранее." }[lang], requires: "RPC_VERIFIED" },
      { key: "close", title: { EN: "Close", AZ: "Bağla", RU: "Завершение" }[lang], text: { EN: "Thank you for your time. Goodbye.", AZ: "Vaxt ayırdığınız üçün təşəkkür edirəm. Sağ olun.", RU: "Спасибо за уделённое время. До свидания." }[lang], requires: "NONE" },
    ],
    thirdParty: { EN: "I am calling from ATB about a personal matter. Please ask {{customerName}} to call us back at the number on their statement. I cannot discuss details with anyone else.", AZ: "ATB-dən şəxsi məsələ ilə bağlı zəng edirəm. {{customerName}}-dən bizə geri zəng etməsini xahiş edin. Başqa şəxslə detalları müzakirə edə bilmərəm.", RU: "Звоню из ATB по личному вопросу. Попросите {{customerName}} перезвонить нам. Я не могу обсуждать детали с другими лицами." }[lang],
    branches: [
      { response: "Payment timing", route: "PTP_OR_CALLBACK" },
      { response: "Already paid", route: "RECONCILE_CLAIM" },
      { response: "Affordability difficulty", route: "SUPPORT_REFERRAL" },
      { response: "Debt disputed", route: "DISPUTE" },
    ],
  });
  for (const lang of ["EN", "AZ", "RU"] as const) {
    await prisma.template.upsert({
      where: { code_version_language: { code: "SOFT-01", version: "1.0", language: lang } },
      create: { id: `TPL-SOFT-01-${lang}`, code: "SOFT-01", version: "1.0", kind: "AGENT_SCRIPT", language: lang, status: "ACTIVE", title: "Soft collection conversation (early arrears)", body: scriptBody(lang) as never, variables: ["agentName", "customerName", "overdueAmount", "oldestDueDate", "dpd", "promiseAmount", "promiseDate"], channelScope: ["VOICE"], effectiveFrom: new Date("2026-10-01T00:00:00Z"), approvedBy: "U-HEAD (demo)", createdBy: "U-HEAD" },
      update: { body: scriptBody(lang) as never },
    });
    const sms = {
      EN: "ATB: your installment of {{overdueAmount}} AZN due {{oldestDueDate}} is unpaid. Please pay via ATB mobile or any branch. Questions: call the number on your statement.",
      AZ: "ATB: {{oldestDueDate}} tarixli {{overdueAmount}} AZN ödənişiniz ödənilməyib. ATB mobil və ya filial vasitəsilə ödəyin. Suallar üçün çıxarışdakı nömrəyə zəng edin.",
      RU: "ATB: ваш платёж {{overdueAmount}} AZN со сроком {{oldestDueDate}} не оплачен. Оплатите через ATB mobile или в отделении. Вопросы: номер в выписке.",
    }[lang];
    await prisma.template.upsert({
      where: { code_version_language: { code: "SMS-REMINDER-01", version: "1.0", language: lang } },
      create: { id: `TPL-SMS-01-${lang}`, code: "SMS-REMINDER-01", version: "1.0", kind: "SMS", language: lang, status: "ACTIVE", title: "Overdue installment reminder", body: { text: sms } as never, variables: ["overdueAmount", "oldestDueDate"], channelScope: ["SMS"], effectiveFrom: new Date("2026-10-01T00:00:00Z"), approvedBy: "U-HEAD (demo)", createdBy: "U-HEAD" },
      update: {},
    });
    const ptp = {
      EN: "ATB: reminder of your agreed payment of {{promiseAmount}} AZN by {{promiseDate}}. Thank you.",
      AZ: "ATB: {{promiseDate}} tarixinədək razılaşdırılmış {{promiseAmount}} AZN ödənişinizi xatırladırıq. Təşəkkür edirik.",
      RU: "ATB: напоминаем о согласованном платеже {{promiseAmount}} AZN до {{promiseDate}}. Спасибо.",
    }[lang];
    await prisma.template.upsert({
      where: { code_version_language: { code: "PTP-REMINDER-01", version: "1.0", language: lang } },
      create: { id: `TPL-PTP-01-${lang}`, code: "PTP-REMINDER-01", version: "1.0", kind: "PTP_REMINDER", language: lang, status: "ACTIVE", title: "Promise-to-pay reminder", body: { text: ptp } as never, variables: ["promiseAmount", "promiseDate"], channelScope: ["SMS"], effectiveFrom: new Date("2026-10-01T00:00:00Z"), approvedBy: "U-HEAD (demo)", createdBy: "U-HEAD" },
      update: {},
    });
  }
  await prisma.template.upsert({
    where: { code_version_language: { code: "SMS-REMINDER-02", version: "0.1", language: "AZ" } },
    create: { id: "TPL-SMS-02-AZ-DRAFT", code: "SMS-REMINDER-02", version: "0.1", kind: "SMS", language: "AZ", status: "DRAFT", title: "Second reminder (draft, not approved)", body: { text: "ATB: ikinci xatırlatma. {{overdueAmount}} AZN ödənişiniz gecikir." } as never, variables: ["overdueAmount"], channelScope: ["SMS"], createdBy: "U-HEAD" },
    update: {},
  });

  await prisma.campaign.upsert({
    where: { code: "SOFT_COLLECTIONS_VOICE" },
    create: { id: "CMP-VOICE", code: "SOFT_COLLECTIONS_VOICE", name: "Soft collections - progressive voice", kind: "VOICE", status: "RUNNING", strategyVersionId: activeStrategy.id, languages: ["AZ", "EN", "RU"], createdBy: "U-HEAD", approverUserId: "U-APPROVER", audienceSnapshot: { rule: "Eligible CALL work items under the active strategy; re-checked at reservation and before dial" } as never },
    update: {},
  });
  await prisma.campaign.upsert({
    where: { code: "SMS_REMINDER_DAILY" },
    create: { id: "CMP-SMS", code: "SMS_REMINDER_DAILY", name: "Daily overdue SMS reminder (buckets 1-7)", kind: "SMS", status: "RUNNING", strategyVersionId: activeStrategy.id, templateId: "TPL-SMS-01-AZ", languages: ["AZ", "EN", "RU"], createdBy: "U-HEAD", approverUserId: "U-APPROVER", costEstimate: "4.65", audienceSnapshot: { rule: "DIGITAL_REMINDER work items; policy re-checked at dispatch; demo send writes to the local outbound log only" } as never },
    update: {},
  });
  await prisma.campaign.upsert({
    where: { code: "SMS_SECOND_REMINDER_NOV" },
    create: { id: "CMP-SMS-DRAFT", code: "SMS_SECOND_REMINDER_NOV", name: "Second SMS reminder (November draft)", kind: "SMS", status: "DRAFT", strategyVersionId: "SV-DRAFT-2026-11", templateId: "TPL-SMS-02-AZ-DRAFT", languages: ["AZ"], createdBy: "U-HEAD", audienceSnapshot: { rule: "Blocked: draft strategy and unapproved template" } as never },
    update: {},
  });

  const fresh = DEMO_SEED_INSTANT;
  const watermarks = [
    { sourceSystem: "CORE_BANKING", displayName: "Core loans, schedules & balances", mode: "MOCK_INBOUND", health: "HEALTHY", lag: 120, threshold: 900 },
    { sourceSystem: "CUSTOMER_MASTER", displayName: "Customer & contact master", mode: "MOCK_INBOUND", health: "HEALTHY", lag: 300, threshold: 3600 },
    { sourceSystem: "PAYMENT_FEED", displayName: "Payment / reversal feed", mode: "MOCK_INBOUND", health: "HEALTHY", lag: 120, threshold: 900 },
    { sourceSystem: "PROMETEIA_FEATURES", displayName: "Prometeia feature / score import", mode: "FILE_DRAFT", health: "DEGRADED", lag: 27 * 86400, threshold: 45 * 86400 },
    { sourceSystem: "SMS_GATEWAY", displayName: "SMS gateway", mode: "LOCAL_OUTBOX", health: "HEALTHY", lag: 0, threshold: 3600 },
    { sourceSystem: "DIALER", displayName: "Dialer / CTI", mode: "MOCK_PROVIDER", health: "HEALTHY", lag: 0, threshold: 300 },
    { sourceSystem: "IDENTITY", displayName: "Identity provider", mode: "LOCAL_DEMO", health: "HEALTHY", lag: 0, threshold: 3600 },
    { sourceSystem: "BI_EXPORT", displayName: "BI / reporting export", mode: "DISABLED", health: "DISABLED", lag: 0, threshold: 86400 },
  ] as const;
  for (const w of watermarks) {
    await prisma.sourceWatermark.upsert({
      where: { sourceSystem: w.sourceSystem },
      create: { sourceSystem: w.sourceSystem, displayName: w.displayName, mode: w.mode, health: w.health, lastSuccessfulRunAt: w.health === "DISABLED" ? null : fresh, sourceAsOf: w.health === "DISABLED" ? null : new Date(fresh.getTime() - w.lag * 1000), lagSeconds: w.lag, freshnessThresholdSeconds: w.threshold, notes: w.mode === "FILE_DRAFT" ? "Monthly snapshot 2026-09 (draft model inputs); latest complete month" : w.mode === "DISABLED" ? "No BI contract supplied" : undefined },
      update: { lastSuccessfulRunAt: w.health === "DISABLED" ? null : fresh, sourceAsOf: w.health === "DISABLED" ? null : new Date(fresh.getTime() - w.lag * 1000), health: w.health },
    });
  }

  const metrics = [
    { code: "ATTEMPTS", name: "Attempts", numerator: "Recorded outbound dial attempts (provider callbacks deduplicated per attempt)", denominator: "—", scope: "Period / agent / team", unit: "count" },
    { code: "DISTINCT_CUSTOMERS_ATTEMPTED", name: "Distinct customers attempted", numerator: "Unique customers with ≥1 qualifying attempt in the period", denominator: "—", scope: "Period", unit: "count" },
    { code: "RPC_RATE_ATTEMPT", name: "RPC rate (attempt-based)", numerator: "Verified right-party conversations", denominator: "Qualifying attempts", scope: "Period", unit: "ratio" },
    { code: "RPC_RATE_CUSTOMER", name: "RPC rate (distinct-customer)", numerator: "Distinct customers with ≥1 verified RPC", denominator: "Distinct customers attempted", scope: "Period", unit: "ratio" },
    { code: "COVERAGE", name: "Coverage", numerator: "Distinct eligible customers worked", denominator: "Distinct eligible customers assigned in the snapshot", scope: "Snapshot", unit: "ratio" },
    { code: "PTP_CONVERSION", name: "PTP conversion", numerator: "Promises obtained", denominator: "Verified eligible conversations", scope: "Period", unit: "ratio" },
    { code: "KEPT_PTP_RATE", name: "Kept PTP rate", numerator: "Kept promises", denominator: "Matured eligible promises (not-yet-due excluded; pending reconciliation shown separately)", scope: "Maturity cohort", unit: "ratio" },
    { code: "CURE", name: "Cure", numerator: "Entry cohort customers returning to zero overdue within the window", denominator: "Entry cohort", scope: "Fixed entry cohort", unit: "ratio" },
    { code: "ROLL_FORWARD", name: "Roll-forward", numerator: "Entry cohort crossing the threshold within the horizon", denominator: "Entry cohort (matured observations)", scope: "Fixed entry cohort", unit: "ratio" },
    { code: "CASH_RECEIVED", name: "Cash received", numerator: "Verified posted inflows net of reversals (value-date convention)", denominator: "—", scope: "Period / scope / AZN", unit: "AZN" },
    { code: "AGENT_ATTRIBUTED_CASH", name: "Agent-attributed cash", numerator: "Verified allocations credited once to the agent of the latest verified RPC within 10 days (demo rule)", denominator: "—", scope: "Period / agent", unit: "AZN" },
    { code: "COST", name: "Cost", numerator: "SMS units × unit cost; agent customer-days × unit cost (scenario where assumed)", denominator: "—", scope: "Period", unit: "AZN" },
  ];
  for (const m of metrics) {
    await prisma.metricDefinition.upsert({ where: { code: m.code }, create: { ...m, version: "1.0", asOf: new Date("2026-10-27T00:00:00Z") }, update: {} });
  }

  // Approvals pending for the inbox (maker/checker).
  await prisma.approvalRequest.upsert({
    where: { id: "APR-MODEL-CANDIDATE" },
    create: { id: "APR-MODEL-CANDIDATE", type: "MODEL_ACTIVATION", status: "PENDING", makerUserId: "U-MODEL", objectType: "ModelVersion", objectId: "MV-CANDIDATE", title: "Activate Prometeia candidate CANDIDATE-2026-11", rationale: "Golden cases pass; provider confirmation of the Class 7 leaf still outstanding.", beforeJson: { active: activeModel.version } as never, afterJson: { active: "CANDIDATE-2026-11" } as never, impactJson: { population: "DPD 4-10 scored customers", expectedScoreChanges: 0 } as never, validationJson: { goldenCases: "8/8 pass", boundaries: "pass", unresolved: ["Class 7 leaf label", "DPD 10 boundary"] } as never, rollbackTargetId: activeModel.id },
    update: {},
  });
  await prisma.approvalRequest.upsert({
    where: { id: "APR-STRATEGY-DRAFT" },
    create: { id: "APR-STRATEGY-DRAFT", type: "STRATEGY_ACTIVATION", status: "INFO_REQUESTED", makerUserId: "U-RISK", checkerUserId: "U-APPROVER", objectType: "StrategyVersion", objectId: "SV-DRAFT-2026-11", title: "Activate strategy 2026.11-draft (bucket 7 to regular calls)", rationale: "Spare regular capacity observed in October.", decisionNote: "Please attach the dry-simulation workload and capacity impact before approval.", impactJson: { additionalCallItems: "pending dry run" } as never, rollbackTargetId: activeStrategy.id },
    update: {},
  });
}
