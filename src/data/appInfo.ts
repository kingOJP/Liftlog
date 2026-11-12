// What this build is and who to contact about it.
//
// The version and build id are stamped by Vite at build time (vite.config.ts);
// Settings shows them so a bug report can name the exact build, and crash
// reports carry them. The support address is configuration, not code: set
// VITE_SUPPORT_EMAIL in the build environment (see docs/ios-launch.md). With
// none set, the legal and support pages say so honestly instead of printing a
// placeholder address.

declare const __APP_VERSION__: string;
declare const __BUILD_ID__: string;

export const APP_NAME = 'LiftLog';

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

const configuredEmail = (import.meta.env?.VITE_SUPPORT_EMAIL as string | undefined)?.trim();
export const SUPPORT_EMAIL: string | null =
  configuredEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configuredEmail) ? configuredEmail : null;

/** The date the privacy policy and terms were last changed. */
export const LEGAL_UPDATED = '12 November 2026';

export function versionLabel(): string {
  return `${APP_NAME} ${APP_VERSION} (${BUILD_ID})`;
}
