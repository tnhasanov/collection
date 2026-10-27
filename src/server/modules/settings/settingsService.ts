import type { Db } from "@/server/db";
import { prisma } from "@/server/db";
import { DEFAULT_SETTINGS } from "@/server/modules/policy/defaults";
import { DEMO_CONTACT_POLICY, type ContactPolicyConfig } from "@/server/modules/contactPolicy/types";

const cache = new Map<string, { value: unknown; at: number }>();
const TTL_MS = 5_000;

export function invalidateSettingsCache() {
  cache.clear();
}

export async function getSetting<T = unknown>(key: string, db: Db = prisma): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const row = await db.setting.findUnique({ where: { key } });
  const fallback = DEFAULT_SETTINGS.find((d) => d.key === key)?.value;
  const value = (row ? row.value : fallback) as T;
  cache.set(key, { value, at: Date.now() });
  return value;
}

export async function getContactPolicy(db: Db = prisma): Promise<ContactPolicyConfig> {
  const v = await getSetting<Partial<ContactPolicyConfig> | null>("contactPolicy.active", db);
  return { ...DEMO_CONTACT_POLICY, ...(v ?? {}) };
}

export async function getOutboundControls(db: Db = prisma) {
  const [killSwitch, pausedChannels, pausedCampaigns] = await Promise.all([
    getSetting<boolean>("outbound.killSwitch", db),
    getSetting<string[]>("outbound.pausedChannels", db),
    getSetting<string[]>("outbound.pausedCampaigns", db),
  ]);
  return { killSwitch: !!killSwitch, pausedChannels: pausedChannels ?? [], pausedCampaigns: pausedCampaigns ?? [] };
}

export async function setSetting(db: Db, key: string, value: unknown, updatedBy: string) {
  const def = DEFAULT_SETTINGS.find((d) => d.key === key);
  const row = await db.setting.upsert({
    where: { key },
    create: {
      key,
      group: def?.group ?? "custom",
      value: value as never,
      provenance: def?.provenance ?? "DEMO_ASSUMPTION",
      description: def?.description ?? key,
      editableRoles: def?.editableRoles ?? [],
      updatedBy,
    },
    update: { value: value as never, updatedBy, version: { increment: 1 } },
  });
  cache.delete(key);
  return row;
}

export async function ensureDefaultSettings(db: Db) {
  for (const d of DEFAULT_SETTINGS) {
    await db.setting.upsert({
      where: { key: d.key },
      create: { key: d.key, group: d.group, value: d.value as never, provenance: d.provenance, description: d.description, owner: d.owner ?? "collections-product", editableRoles: d.editableRoles ?? [], effectiveFrom: d.effectiveFrom ? new Date(d.effectiveFrom) : null },
      update: {},
    });
  }
  cache.clear();
}
