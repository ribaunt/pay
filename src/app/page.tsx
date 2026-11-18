import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { getWalletInfo } from "@/lib/monero/wallet";
import LogoutButton from "@/components/logout-button";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();
  const [userCount, wallet] = await Promise.all([
    prisma.user.count().catch(() => null),
    user ? getWalletInfo(user.id).catch(() => null) : Promise.resolve(null),
  ]);

  return (
    <main>
      <h1>Ribaunt Pay</h1>
      <p>Next.js, PostgreSQL and Monero wallet RPC running in Docker.</p>

      <div className="card">
        {user ? (
          <>
            <strong>Signed in as {user.email ?? "user"}</strong>
            <LogoutButton />
          </>
        ) : (
          <p>
            <a href="/login">Sign in →</a>
          </p>
        )}
      </div>

      <div className="card">
        <strong>Database:</strong>{" "}
        {userCount === null ? "unreachable" : `${userCount} users`}
      </div>

      <div className="card">
        <strong>Wallet:</strong>{" "}
        {!user ? "sign in to view" : wallet ? wallet.name : "not set up"}
        {wallet && (
          <>
            <p className="address">{wallet.address}</p>
            <p>
              Balance: {wallet.balanceXmr} XMR
              <br />
              Unlocked: {wallet.unlockedBalanceXmr} XMR
              {wallet.blocksToUnlock > 0 &&
                ` (unlocks in ${wallet.blocksToUnlock} blocks)`}
            </p>
          </>
        )}
        {user && !wallet && (
          <p>
            <a href="/setup">Set up a watch-only wallet →</a>
          </p>
        )}
      </div>

      <div className="card">
        <strong>API</strong>
        <ul>
          <li><code>GET /api/health</code> — service health (public)</li>
          <li><code>POST /api/auth/login</code>, <code>/logout</code> — .env credentials only</li>
          <li><code>GET /api/wallet</code> — wallet info</li>
          <li><code>POST /api/wallet/setup</code> — import view key</li>
          <li><code>GET/POST /api/wallet/subaddresses</code> — fresh addresses</li>
          <li><code>POST /api/wallet/payment-requests</code> — payment URI</li>
          <li><code>GET /api/wallet/transfers</code> — history</li>
          <li><code>POST /api/wallet/payment-proofs</code> — create proof</li>
          <li><code>POST /api/payment-links</code> — fiat/XMR link with timeout</li>
          <li><code>GET /api/payment-links/[id]/status</code> — public status</li>
          <li><code>POST /api/public/payment-proofs/verify</code> — verify proof</li>
        </ul>
      </div>
    </main>
  );
}
