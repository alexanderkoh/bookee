/**
 * Application wiring.
 *
 * Creates the database connection, runs migrations, and exposes the repository
 * layer plus the Horizon adapter factory. Components read data through
 * TanStack Query hooks that call these repositories; none of them construct a
 * driver or a client themselves.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { TauriSqlDriver } from "../../db/tauri-driver";
import type { SqlDriver } from "../../db/driver";
import { migrate } from "../../db/migrator";
import { createRepositories, type Repositories } from "../../db/repositories";
import { DEFAULT_HORIZON_URLS, HorizonClient, type StellarDataSource } from "../../stellar/client";
import type { Network } from "../../db/schema";
import { createLogger } from "../../lib/log";

const log = createLogger("app");

export interface AppServices {
  repositories: Repositories;
  dataSourceFor: (network: Network) => StellarDataSource;
  /** The endpoint in use, for callers that talk to Horizon directly. */
  horizonUrlFor: (network: Network) => string;
  schemaVersion: number;
  foreignKeysEnabled: boolean;
}

const AppContext = createContext<AppServices | null>(null);

export const HORIZON_URL_SETTING = "horizon.url";

type Status =
  | { state: "loading" }
  | { state: "ready"; services: AppServices }
  | { state: "error"; error: Error };

export function AppProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        // Preview mode runs the whole application in a plain browser against
        // SQLite-WASM with seeded data. It is how the interface is reviewed
        // without a native build, and it exercises the SqlDriver seam for real.
        const preview = import.meta.env.VITE_PREVIEW === "1";

        let driver: SqlDriver;
        let foreignKeysEnabled: boolean;
        let previewSource: StellarDataSource | null = null;

        if (preview) {
          const [{ WasmSqlDriver }, { seedPreview, previewDataSource }] = await Promise.all([
            import("../../preview/wasm-driver"),
            import("../../preview/seed"),
          ]);
          const wasm = await WasmSqlDriver.open();
          await migrate(wasm);
          await seedPreview(createRepositories(wasm));
          driver = wasm;
          foreignKeysEnabled = true;
          previewSource = previewDataSource();
        } else {
          const tauri = await TauriSqlDriver.connect();
          await migrate(tauri);
          foreignKeysEnabled = await tauri.assertForeignKeys();
          driver = tauri;
        }

        const schemaVersion = await migrate(driver);
        const repositories = createRepositories(driver);

        // Custom Horizon endpoints are per-network overrides stored in settings.
        const settings = await repositories.settings.all();
        const clients = new Map<Network, StellarDataSource>();

        const dataSourceFor = (network: Network): StellarDataSource => {
          const existing = clients.get(network);
          if (existing) return existing;
          if (previewSource) {
            // The preview is offline by design; balances come from the seed.
            clients.set(network, previewSource);
            return previewSource;
          }
          const override = settings[`${HORIZON_URL_SETTING}.${network}`];
          const client = new HorizonClient({
            network,
            ...(override ? { url: override } : {}),
          });
          clients.set(network, client);
          return client;
        };

        const horizonUrlFor = (network: Network): string =>
          settings[`${HORIZON_URL_SETTING}.${network}`] || DEFAULT_HORIZON_URLS[network];

        if (cancelled) return;
        setStatus({
          state: "ready",
          services: {
            repositories,
            dataSourceFor,
            horizonUrlFor,
            schemaVersion,
            foreignKeysEnabled,
          },
        });
        log.info("application ready", { schemaVersion, foreignKeysEnabled });
      } catch (error) {
        log.error("failed to start", {
          reason: error instanceof Error ? error.message : String(error),
        });
        if (!cancelled) {
          setStatus({
            state: "error",
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(() => (status.state === "ready" ? status.services : null), [status]);

  if (status.state === "loading") {
    return (
      <div className="app-boot" role="status" aria-live="polite">
        Opening ledger…
      </div>
    );
  }

  if (status.state === "error") {
    return (
      <div className="app-boot app-boot--error" role="alert">
        <h1>Could not open the local database</h1>
        <p>{status.error.message}</p>
      </div>
    );
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useServices(): AppServices {
  const context = useContext(AppContext);
  if (!context) throw new Error("useServices must be used inside AppProvider");
  return context;
}

export function useRepositories(): Repositories {
  return useServices().repositories;
}
