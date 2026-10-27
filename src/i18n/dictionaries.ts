/**
 * Centralized UI translation dictionaries. English is the default UI language; Azerbaijani and Russian
 * dictionaries share the same keys so screens can switch without code changes. Missing keys fall back to English.
 */
export type Locale = "en" | "az" | "ru";

const en = {
  app: { name: "ATB Collections", internal: "Internal workspace", synthetic: "Synthetic demo data" },
  nav: {
    work: "Work",
    portfolio: "Portfolio",
    strategy: "Strategy",
    management: "Management",
    administration: "Administration",
    myWorkspace: "My workspace",
    overview: "Overview",
    workQueue: "My work queue",
    customers: "Customers",
    promises: "Promises to pay",
    tasks: "Callbacks & tasks",
    payments: "Payments",
    arrangements: "Repayment support",
    approvals: "Approvals",
    strategies: "Treatment rules",
    models: "Prometeia models",
    economics: "Economics & capacity",
    campaigns: "Campaigns",
    templates: "Templates & scripts",
    operations: "Team operations",
    analytics: "Analytics",
    monitoring: "Model monitoring",
    imports: "Imports & data quality",
    integrations: "Integrations",
    exceptions: "Exceptions",
    audit: "Audit",
    settings: "Settings",
    users: "Users & roles",
    recovery: "Late collection & handover",
    agent: "My dashboard",
    agentCall: "Current call",
    agentCallbacks: "My callbacks",
    agentPromises: "My promises",
    agentResults: "My results",
    agentTasks: "Support tasks",
  },
  topbar: {
    search: "Search customer, CIF, loan or case",
    businessDate: "Business date",
    sourceRefreshed: "Source refreshed",
    signOut: "Sign out",
    demo: "DEMO",
    integration: "INTEGRATION",
  },
  common: {
    save: "Save",
    cancel: "Cancel",
    loading: "Loading…",
    empty: "Nothing to show",
    error: "Something went wrong",
    readOnly: "Read-only",
    denied: "You do not have permission to view this",
    stale: "Stale data",
    reason: "Reason",
    customer: "Customer",
    loan: "Loan",
    amount: "Amount",
    status: "Status",
    owner: "Owner",
    date: "Date",
    actions: "Actions",
    azn: "AZN",
  },
  agent: {
    goReady: "Go Ready",
    notReady: "Not ready",
    break: "Break",
    endShift: "End shift",
    saveReady: "Save outcome & return Ready",
    saveNotReady: "Save & stay Not ready",
    verifyRightParty: "Verify right party",
  },
};

export type Dictionary = typeof en;

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

const az: DeepPartial<Dictionary> = {
  app: { name: "ATB Collections", internal: "Daxili iş sahəsi", synthetic: "Sintetik demo məlumatları" },
  nav: {
    work: "İş",
    portfolio: "Portfel",
    strategy: "Strategiya",
    management: "İdarəetmə",
    administration: "Administrasiya",
    myWorkspace: "Mənim iş sahəm",
    overview: "Ümumi baxış",
    workQueue: "Mənim iş növbəm",
    customers: "Müştərilər",
    promises: "Ödəniş vədləri",
    tasks: "Geri zənglər və tapşırıqlar",
    payments: "Ödənişlər",
    arrangements: "Ödəniş dəstəyi",
    approvals: "Təsdiqlər",
    strategies: "Təsir qaydaları",
    models: "Prometeia modelləri",
    economics: "İqtisadiyyat və tutum",
    campaigns: "Kampaniyalar",
    templates: "Şablonlar və skriptlər",
    operations: "Komanda əməliyyatları",
    analytics: "Analitika",
    monitoring: "Model monitorinqi",
    imports: "İdxal və məlumat keyfiyyəti",
    integrations: "İnteqrasiyalar",
    exceptions: "İstisnalar",
    audit: "Audit",
    settings: "Parametrlər",
    users: "İstifadəçilər və rollar",
    recovery: "Gecikmiş yığım və təhvil",
    agent: "Mənim panelim",
    agentCall: "Cari zəng",
    agentCallbacks: "Geri zənglərim",
    agentPromises: "Vədlərim",
    agentResults: "Nəticələrim",
    agentTasks: "Dəstək tapşırıqları",
  },
  topbar: { search: "Müştəri, CIF, kredit və ya iş axtar", businessDate: "Biznes tarixi", sourceRefreshed: "Mənbə yeniləndi", signOut: "Çıxış", demo: "DEMO", integration: "İNTEQRASİYA" },
  common: { save: "Yadda saxla", cancel: "Ləğv et", loading: "Yüklənir…", empty: "Göstəriləcək məlumat yoxdur", error: "Xəta baş verdi", readOnly: "Yalnız oxumaq", denied: "Bu məlumata baxmaq icazəniz yoxdur", stale: "Köhnəlmiş məlumat", reason: "Səbəb", customer: "Müştəri", loan: "Kredit", amount: "Məbləğ", status: "Status", owner: "Sahib", date: "Tarix", actions: "Əməliyyatlar", azn: "AZN" },
  agent: { goReady: "Hazır ol", notReady: "Hazır deyil", break: "Fasilə", endShift: "Növbəni bitir", saveReady: "Nəticəni yadda saxla və Hazır ol", saveNotReady: "Yadda saxla və Hazır deyil qal", verifyRightParty: "Şəxsiyyəti təsdiqlə" },
};

const ru: DeepPartial<Dictionary> = {
  app: { name: "ATB Collections", internal: "Внутреннее рабочее место", synthetic: "Синтетические демо-данные" },
  nav: {
    work: "Работа",
    portfolio: "Портфель",
    strategy: "Стратегия",
    management: "Управление",
    administration: "Администрирование",
    myWorkspace: "Моё рабочее место",
    overview: "Обзор",
    workQueue: "Моя очередь",
    customers: "Клиенты",
    promises: "Обещания оплаты",
    tasks: "Обратные звонки и задачи",
    payments: "Платежи",
    arrangements: "Поддержка погашения",
    approvals: "Согласования",
    strategies: "Правила воздействия",
    models: "Модели Prometeia",
    economics: "Экономика и мощность",
    campaigns: "Кампании",
    templates: "Шаблоны и скрипты",
    operations: "Операции команды",
    analytics: "Аналитика",
    monitoring: "Мониторинг моделей",
    imports: "Импорт и качество данных",
    integrations: "Интеграции",
    exceptions: "Исключения",
    audit: "Аудит",
    settings: "Настройки",
    users: "Пользователи и роли",
    recovery: "Поздний сбор и передача",
    agent: "Моя панель",
    agentCall: "Текущий звонок",
    agentCallbacks: "Мои обратные звонки",
    agentPromises: "Мои обещания",
    agentResults: "Мои результаты",
    agentTasks: "Задачи поддержки",
  },
  topbar: { search: "Поиск клиента, CIF, кредита или дела", businessDate: "Бизнес-дата", sourceRefreshed: "Источник обновлён", signOut: "Выйти", demo: "ДЕМО", integration: "ИНТЕГРАЦИЯ" },
  common: { save: "Сохранить", cancel: "Отмена", loading: "Загрузка…", empty: "Нет данных", error: "Произошла ошибка", readOnly: "Только чтение", denied: "Нет прав для просмотра", stale: "Устаревшие данные", reason: "Причина", customer: "Клиент", loan: "Кредит", amount: "Сумма", status: "Статус", owner: "Владелец", date: "Дата", actions: "Действия", azn: "AZN" },
  agent: { goReady: "Готов", notReady: "Не готов", break: "Перерыв", endShift: "Завершить смену", saveReady: "Сохранить результат и вернуться в Готов", saveNotReady: "Сохранить и остаться Не готов", verifyRightParty: "Подтвердить личность" },
};

export const dictionaries: Record<Locale, DeepPartial<Dictionary>> = { en, az, ru };

function lookup(obj: unknown, path: string[]): string | undefined {
  let cur: unknown = obj;
  for (const p of path) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[p];
    else return undefined;
  }
  return typeof cur === "string" ? cur : undefined;
}

/** Translate a dotted key, falling back to English and finally to the key itself. */
export function t(locale: Locale, key: string): string {
  const path = key.split(".");
  return lookup(dictionaries[locale], path) ?? lookup(en, path) ?? key;
}

export const SUPPORTED_LOCALES: { code: Locale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "az", label: "Azərbaycan dili" },
  { code: "ru", label: "Русский" },
];
