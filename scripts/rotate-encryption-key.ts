/**
 * Re-encrypts stored secrets under the active encryption key.
 *
 * Dry run by default; pass --apply to write. Requires the old key to be listed
 * in WALLET_ENCRYPTION_PREVIOUS_KEYS as id:64-hex-key, and a NEW
 * WALLET_ENCRYPTION_KEY_ID (key ids must never be reused with different material).
 *
 *   WALLET_ENCRYPTION_PREVIOUS_KEYS=env-1:<old-key> \
 *   WALLET_ENCRYPTION_KEY_ID=env-2 WALLET_ENCRYPTION_KEY=<new-key> \
 *   npx tsx scripts/rotate-encryption-key.ts --apply
 */
import { prisma } from "../src/lib/prisma";
import {
  reencryptSecret,
  needsRotation,
  VIEW_KEY_PURPOSE,
  WEBHOOK_SECRET_PURPOSE,
} from "../src/lib/crypto";

const apply = process.argv.includes("--apply");

async function main() {
  const wallets = await prisma.wallet.findMany({ where: { viewKey: { not: null } } });
  const webhooks = await prisma.webhookEndpoint.findMany();

  const plan: Array<{
    kind: string;
    id: string;
    value: string;
    purpose: string;
    update: (value: string) => Promise<unknown>;
  }> = [];

  for (const wallet of wallets) {
    if (!wallet.viewKey) continue;
    plan.push({
      kind: "wallet.viewKey",
      id: wallet.userId,
      value: wallet.viewKey,
      purpose: VIEW_KEY_PURPOSE,
      update: (value) =>
        prisma.wallet.update({ where: { id: wallet.id }, data: { viewKey: value } }),
    });
  }

  for (const endpoint of webhooks) {
    plan.push({
      kind: "webhookEndpoint.secret",
      id: endpoint.id,
      value: endpoint.secret,
      purpose: WEBHOOK_SECRET_PURPOSE,
      update: (value) =>
        prisma.webhookEndpoint.update({ where: { id: endpoint.id }, data: { secret: value } }),
    });
  }

  const stale = plan.filter((item) => needsRotation(item.value));
  console.log(`records: ${plan.length}, needing rotation: ${stale.length}`);

  if (!apply) {
    console.log("Dry run. Pass --apply to write.");
    return;
  }

  for (const item of stale) {
    const rotated = reencryptSecret(item.value, item.purpose, item.id);
    await item.update(rotated);
  }

  let remaining = 0;
  for (const item of plan) {
    const current = item.kind === "wallet.viewKey"
      ? (await prisma.wallet.findFirst({ where: { userId: item.id } }))?.viewKey
      : (await prisma.webhookEndpoint.findUnique({ where: { id: item.id } }))?.secret;
    if (current && needsRotation(current)) remaining += 1;
  }
  console.log(`verification: ${remaining} records still reference an old key id`);
  if (remaining > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
