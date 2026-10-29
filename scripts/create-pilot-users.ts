import "dotenv/config";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createPrismaClient } from "../src/server/db";
import { hashPassword } from "../src/server/auth/password";
import type { Language, Role, Seniority } from "../src/generated/prisma/enums";

/**
 * Creates individual tester identities for a PILOT environment.
 *
 *   npm run pilot:users -- --example pilot-users.json      # writes an example definition file
 *   npm run pilot:users -- pilot-users.json                # creates/updates the users, prints one-time passwords
 *   npm run pilot:users -- --disable-demo-identities       # deactivates the shared demo accounts (seeded *@demo.atb.local)
 *
 * Every created user gets a random temporary password (printed once, never stored in clear) and must set a personal
 * password at first sign-in. Nothing here touches synthetic data, migrations or demo history.
 */
interface Def {
  username: string;
  displayName: string;
  role: Role;
  email?: string;
  teamId?: string | null;
  languages?: Language[];
  branchScopes?: string[];
  seniority?: Seniority;
  extension?: string;
}

const EXAMPLE: Def[] = [
  { username: "pilot.agent1", displayName: "Pilot Agent 1", role: "AGENT", teamId: "T-REGULAR", languages: ["AZ", "RU"], seniority: "REGULAR", extension: "2101" },
  { username: "pilot.senior1", displayName: "Pilot Senior 1", role: "SENIOR_AGENT", teamId: "T-SENIOR", languages: ["AZ", "RU", "EN"], seniority: "SENIOR", extension: "2201" },
  { username: "pilot.lead", displayName: "Pilot Team Lead", role: "TEAM_LEAD", teamId: "T-MGMT", languages: ["AZ", "RU"] },
  { username: "pilot.head", displayName: "Pilot Collections Head", role: "COLLECTIONS_HEAD", teamId: "T-MGMT", languages: ["AZ", "EN"] },
  { username: "pilot.admin", displayName: "Pilot Administrator", role: "ADMIN", teamId: "T-TECH", languages: ["AZ", "EN"] },
];

function tempPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(14);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const prisma = createPrismaClient();
  try {
    if (args[0] === "--example") {
      const file = args[1] ?? "pilot-users.json";
      writeFileSync(file, JSON.stringify(EXAMPLE, null, 2));
      console.log(`Example written to ${file}. Edit it (usernames, roles, extensions) and run again with the file path.`);
      return;
    }
    if (args[0] === "--disable-demo-identities") {
      const r = await prisma.user.updateMany({ where: { email: { endsWith: "@demo.atb.local" }, isServiceAccount: false }, data: { isActive: false } });
      await prisma.session.updateMany({ where: { revokedAt: null, user: { email: { endsWith: "@demo.atb.local" } } }, data: { revokedAt: new Date() } });
      await prisma.auditEvent.create({ data: { action: "pilot.demo_identities_disabled", objectType: "User", actorService: "pilot-script", changes: { disabled: r.count } as never } });
      console.log(`Disabled ${r.count} shared demo identities and revoked their sessions. Demo history stays attributed to them.`);
      return;
    }
    const file = args[0];
    if (!file) throw new Error("Usage: pilot:users <definitions.json> | --example [file] | --disable-demo-identities");
    const defs = JSON.parse(readFileSync(file, "utf8")) as Def[];
    const rows: { username: string; role: string; password: string }[] = [];
    for (const d of defs) {
      if (!/^[a-z0-9._-]{3,40}$/.test(d.username)) throw new Error(`Invalid username ${d.username} (lowercase letters, digits, . _ -)`);
      const password = tempPassword();
      const isAgent = d.role === "AGENT" || d.role === "SENIOR_AGENT";
      const user = await prisma.user.upsert({
        where: { username: d.username },
        create: {
          username: d.username,
          displayName: d.displayName,
          role: d.role,
          email: d.email ?? null,
          teamId: d.teamId ?? null,
          languages: d.languages ?? ["AZ"],
          skills: isAgent ? (d.seniority === "SENIOR" ? ["VOICE", "SENIOR", "COMPLEX_CASES"] : ["VOICE"]) : [],
          branchScopes: d.branchScopes ?? [],
          passwordHash: hashPassword(password),
          mustChangePassword: true,
          identityRef: `pilot:${d.username}`,
        },
        update: { displayName: d.displayName, role: d.role, teamId: d.teamId ?? null, languages: d.languages ?? ["AZ"], branchScopes: d.branchScopes ?? [], passwordHash: hashPassword(password), mustChangePassword: true, isActive: true },
      });
      if (isAgent) {
        const seniority: Seniority = d.seniority ?? (d.role === "SENIOR_AGENT" ? "SENIOR" : "REGULAR");
        const extension = d.extension ?? String(3000 + rows.length);
        await prisma.agentProfile.upsert({
          where: { userId: user.id },
          create: { userId: user.id, seniority, extension, providerAgentRef: `mock-agent-${extension}`, campaignCodes: ["SOFT_COLLECTIONS_VOICE"], shiftStart: "09:00", shiftEnd: "18:00", manualDialAllowed: seniority === "SENIOR" },
          update: { seniority, extension, manualDialAllowed: seniority === "SENIOR" },
        });
      }
      await prisma.auditEvent.create({ data: { action: "pilot.user_provisioned", objectType: "User", objectId: user.id, actorService: "pilot-script", changes: { username: d.username, role: d.role } as never } });
      rows.push({ username: d.username, role: d.role, password });
    }
    console.log("\nOne-time temporary passwords (hand each to its tester privately; they are not stored in clear):\n");
    for (const r of rows) console.log(`  ${r.username.padEnd(20)} ${r.role.padEnd(20)} ${r.password}`);
    console.log("\nEach tester must set a personal password at first sign-in (mustChangePassword).");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
