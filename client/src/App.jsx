import { useEffect, useMemo, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

const connectionCards = [
  {
    id: "facebook",
    title: "Connect Facebook Page",
    description:
      "Use Facebook Login to connect Pages you manage and publish Page posts.",
    action: "Connect Facebook",
    href: `${API_BASE_URL}/api/auth/facebook/start`,
    badge: "Facebook"
  },
  {
    id: "instagram-facebook",
    title: "Instagram with Facebook",
    description:
      "Best when the Instagram professional account is linked to a Facebook Page.",
    action: "Connect via Facebook",
    href: `${API_BASE_URL}/api/auth/instagram/facebook/start`,
    badge: "Instagram"
  },
  {
    id: "instagram-direct",
    title: "Direct Instagram Integration",
    description:
      "Use Instagram Login for professional accounts that you want to connect directly.",
    action: "Connect Instagram",
    href: `${API_BASE_URL}/api/auth/instagram/start`,
    badge: "Instagram"
  }
];

export default function App() {
  const [accounts, setAccounts] = useState([]);
  const [health, setHealth] = useState(null);
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [message, setMessage] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [link, setLink] = useState("");
  const [status, setStatus] = useState(null);
  const [isPublishing, setIsPublishing] = useState(false);

  const resultMessage = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const authStatus = params.get("status");
    const accountCount = params.get("accounts");

    if (!authStatus) {
      return null;
    }

    if (authStatus === "facebook_connected") {
      return `Facebook connection complete. ${accountCount || 0} account(s) added.`;
    }

    if (authStatus === "instagram_connected") {
      return "Instagram connection complete. 1 account added.";
    }

    if (authStatus === "instagram_facebook_connected") {
      return `Instagram with Facebook connection complete. ${accountCount || 0} account(s) added.`;
    }

    return null;
  }, []);

  useEffect(() => {
    loadHealth();
    loadAccounts();
  }, []);

  useEffect(() => {
    if (resultMessage) {
      setStatus({ type: "success", message: resultMessage, context: "auth" });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [resultMessage]);

  async function loadHealth() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/health`);
      setHealth(await response.json());
    } catch {
      setHealth({ ok: false, configured: false });
    }
  }

  async function loadAccounts() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/accounts`);
      const payload = await response.json();
      setAccounts(payload.accounts || []);
      setSelectedAccounts((current) =>
        current.filter((accountId) =>
          payload.accounts?.some((account) => account.id === accountId)
        )
      );
    } catch (error) {
      setStatus({ type: "error", message: error.message });
    }
  }

  function toggleAccount(accountId) {
    setSelectedAccounts((current) =>
      current.includes(accountId)
        ? current.filter((id) => id !== accountId)
        : [...current, accountId]
    );
  }

  async function disconnectAccount(accountId) {
    await fetch(`${API_BASE_URL}/api/accounts/${encodeURIComponent(accountId)}`, {
      method: "DELETE"
    });
    await loadAccounts();
  }

  async function publishPost(event) {
    event.preventDefault();
    setIsPublishing(true);
    setStatus(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          accountIds: selectedAccounts,
          message,
          caption: message,
          imageUrl,
          link
        })
      });
      const payload = await response.json();

      if (!response.ok && !payload.results) {
        throw new Error(payload.error || "Publish failed.");
      }

      const successCount = payload.results.filter((result) => result.ok).length;
      const failCount = payload.results.length - successCount;
      setStatus({
        type: failCount ? "warning" : "success",
        message: `Publish finished. Success: ${successCount}, Failed: ${failCount}.`,
        details: payload.results,
        context: "publish"
      });
    } catch (error) {
      setStatus({ type: "error", message: error.message, context: "publish" });
    } finally {
      setIsPublishing(false);
    }
  }

  const facebookAccounts = accounts.filter((account) => account.provider === "facebook");
  const instagramAccounts = accounts.filter(
    (account) => account.provider === "instagram"
  );
  const hasFacebookWithoutInstagram =
    facebookAccounts.length > 0 && instagramAccounts.length === 0;

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Meta Graph API POC</p>
          <h1>Connect Facebook and Instagram, then publish a post</h1>
          <p className="hero-copy">
            This POC stores connections only in server memory. Restarting the API
            clears tokens and connected accounts.
          </p>
        </div>
        <div className={health?.configured ? "config-pill ok" : "config-pill warn"}>
          {health?.configured ? "Meta config ready" : "Meta config missing"}
        </div>
      </section>

      {!health?.configured && (
        <div className="notice warning">
          Update `.env` and restart the API before OAuth. Missing:{" "}
          {(health?.missingConfig || ["META_APP_ID", "META_APP_SECRET"]).join(
            ", "
          )}
          .
        </div>
      )}

      {status && status.context !== "publish" && <StatusNotice status={status} />}

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Step 1</p>
            <h2>Connect accounts</h2>
          </div>
          <button className="ghost-button" onClick={loadAccounts} type="button">
            Refresh
          </button>
        </div>
        <div className="connection-grid">
          {connectionCards.map((card) => (
            <article className="connection-card" key={card.id}>
              <span className={`provider-badge ${card.badge.toLowerCase()}`}>
                {card.badge}
              </span>
              <h3>{card.title}</h3>
              <p>{card.description}</p>
              <a
                className="primary-button"
                href={card.href}
                rel="noreferrer"
                target="_blank"
              >
                {card.action}
              </a>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Step 2</p>
            <h2>Connected accounts</h2>
          </div>
          <span className="account-count">{accounts.length} connected</span>
        </div>

        {accounts.length === 0 ? (
          <div className="empty-state">No accounts connected yet.</div>
        ) : (
          <>
            {hasFacebookWithoutInstagram && (
              <div className="notice warning compact">
                Facebook connected, but Meta did not return a linked Instagram
                professional account for that Page. Link a Business/Creator
                Instagram account to this exact Facebook Page, then disconnect
                and reconnect.
              </div>
            )}
            <div className="account-columns">
              <AccountGroup
                title="Facebook Pages"
                accounts={facebookAccounts}
                selectedAccounts={selectedAccounts}
                onToggle={toggleAccount}
                onDisconnect={disconnectAccount}
              />
              <AccountGroup
                title="Instagram Accounts"
                accounts={instagramAccounts}
                selectedAccounts={selectedAccounts}
                onToggle={toggleAccount}
                onDisconnect={disconnectAccount}
              />
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Step 3</p>
            <h2>Publish post</h2>
          </div>
        </div>
        <form className="publish-form" onSubmit={publishPost}>
          <label>
            Caption / Facebook message
            <textarea
              placeholder="Write the post copy..."
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={5}
            />
          </label>

          <label>
            Public image URL for Instagram
            <input
              placeholder="https://your-public-image-url.jpg"
              type="url"
              value={imageUrl}
              onChange={(event) => setImageUrl(event.target.value)}
            />
            <small>
              Instagram publishing requires a publicly reachable image URL. For
              the POC, paste a direct hosted JPG URL, not a Google image search
              or encrypted thumbnail URL.
            </small>
          </label>

          <label>
            Optional link for Facebook
            <input
              placeholder="https://example.com"
              type="url"
              value={link}
              onChange={(event) => setLink(event.target.value)}
            />
          </label>

          <button
            className="primary-button wide"
            disabled={isPublishing || selectedAccounts.length === 0}
            type="submit"
          >
            {isPublishing
              ? "Publishing..."
              : `Publish to ${selectedAccounts.length} account(s)`}
          </button>
          {status && status.context === "publish" && (
            <StatusNotice status={status} />
          )}
        </form>
      </section>
    </main>
  );
}

function StatusNotice({ status }) {
  return (
    <div className={`notice ${status.type}`}>
      <strong>{status.message}</strong>
      {status.details && <pre>{JSON.stringify(status.details, null, 2)}</pre>}
    </div>
  );
}

function AccountGroup({
  title,
  accounts,
  selectedAccounts,
  onToggle,
  onDisconnect
}) {
  return (
    <div className="account-group">
      <h3>{title}</h3>
      {accounts.length === 0 ? (
        <div className="empty-state small">None connected.</div>
      ) : (
        accounts.map((account) => (
          <div className="account-row" key={account.id}>
            <label className="account-select">
              <input
                checked={selectedAccounts.includes(account.id)}
                onChange={() => onToggle(account.id)}
                type="checkbox"
              />
              <span>
                <strong>{account.displayName}</strong>
                <small>{formatAccountSubtitle(account)}</small>
                {account.provider === "instagram" && (
                  <small>
                    Publish permission:{" "}
                    {account.metadata?.hasContentPublishPermission
                      ? "granted"
                      : "missing"}
                  </small>
                )}
                {account.metadata?.permissions?.length > 0 && (
                  <small>
                    Permissions: {account.metadata.permissions.join(", ")}
                  </small>
                )}
              </span>
            </label>
            <button
              className="text-button"
              onClick={() => onDisconnect(account.id)}
              type="button"
            >
              Disconnect
            </button>
          </div>
        ))
      )}
    </div>
  );
}

function humanizeConnection(connectionType) {
  return connectionType.replaceAll("_", " ");
}

function formatAccountSubtitle(account) {
  const parts = [humanizeConnection(account.connectionType)];

  if (account.metadata?.tokenType) {
    parts.push(`${humanizeConnection(account.metadata.tokenType)} token`);
  }

  return parts.join(" · ");
}
