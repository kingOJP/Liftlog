import type { ReactNode } from 'react';
import { APP_NAME, LEGAL_UPDATED, SUPPORT_EMAIL, versionLabel } from '../data/appInfo';
import type { LegalDoc } from '../data/legal';
import './LegalView.css';

// Privacy policy, terms and support — real pages at /privacy, /terms and
// /support, readable without signing in (the App Store listing links to them,
// and so do the login screen and Settings). They are part of the app bundle
// rather than a separate site so they are precached, work offline, and can
// never drift from the build that is actually running.

const TITLES: Record<LegalDoc, string> = {
  privacy: 'Privacy Policy',
  terms: 'Terms of Use',
  support: 'Help & Support',
};

function Contact({ lead }: { lead: string }) {
  return SUPPORT_EMAIL ? (
    <p>{lead} <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</p>
  ) : (
    <p>{lead} the support contact shown on {APP_NAME}'s App Store page.</p>
  );
}

function Privacy() {
  return (
    <>
      <p className="legal-lead">
        {APP_NAME} is a training log and coach. This policy says what it stores about you, why,
        and how to get it back or remove it. The short version: it stores what you type in so it
        can sync between your devices, and nothing else. No ads, no trackers, nothing sold.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>
          <strong>Your account.</strong> When you sign in with Google or Apple we receive your name,
          your email address and an account identifier from that provider. With Apple you may
          choose to hide your email, in which case we receive a private relay address instead. We
          never see your password.
        </li>
        <li>
          <strong>Your training.</strong> The workouts, sets, weights, reps and notes you log; your
          program and exercise library; your training plan; and the profile you give the coach —
          goal, experience level, equipment, priority muscles, one-rep maxes and, if you choose to
          enter them, injuries or niggles. Injury information is optional and is used only to keep
          exercises that would aggravate it out of your plan.
        </li>
        <li>
          <strong>A sign-in cookie.</strong> One cookie keeps you signed in and a second holds your
          name and email so the app can show which account is active. They are not used for
          tracking and are not shared.
        </li>
        <li>
          <strong>Crash reports.</strong> If the app hits an error while you are signed in, it sends
          the error message, the app version, the screen you were on and your browser's version
          string, so the problem can be fixed. Crash reports do not contain your workouts.
        </li>
      </ul>

      <h2>What we don't collect</h2>
      <p>
        No advertising identifiers, no third-party analytics, no location, no contacts, no photos,
        no health-app data, no microphone or camera access. {APP_NAME} does not track you across
        other apps or websites.
      </p>

      <h2>How it's used</h2>
      <p>
        Only to run the app for you: to save your training, sync it across the devices you sign in
        on, and compute your recommendations and plans. The coaching is calculated from your own
        history. Your data is not sold, rented, used for advertising, or used to train AI models.
      </p>

      <h2>Where it lives</h2>
      <p>
        On your device (so the app works offline) and on servers operated by Cloudflare, Inc., which
        hosts the app and its database and processes requests — including your IP address — on our
        behalf. Google or Apple handle the sign-in itself under their own privacy policies. No one
        else receives your data.
      </p>

      <h2>Sharing a workout</h2>
      <p>
        If you share a workout, the QR code or link you create contains that workout's exercises,
        sets and rep ranges — not your name, your weights or your history. Anyone you give it to can
        open it.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li><strong>Export.</strong> Settings → Export my data gives you everything as a file.</li>
        <li>
          <strong>Delete.</strong> Settings → Delete account permanently removes your account and all
          training data from our servers and from the device you are using, immediately. It cannot
          be undone. If you signed in with Apple, the app's access to your Apple account is revoked
          at the same time.
        </li>
        <li><strong>Sign out.</strong> Settings → Sign out ends the session on that device.</li>
      </ul>
      <p>
        We keep your data for as long as your account exists. Routine server logs kept by our
        hosting provider expire on their own schedule.
      </p>

      <h2>Children</h2>
      <p>
        {APP_NAME} is not directed at children under 13 (or the age of digital consent where you
        live), and we do not knowingly collect their data.
      </p>

      <h2>Changes</h2>
      <p>
        When this policy changes, this page and the date at the top of it are updated. The page
        always shows the version currently in force.
      </p>

      <h2>Contact</h2>
      <Contact lead="Questions about your data, or a request you can't complete in the app: write to" />
    </>
  );
}

function Terms() {
  return (
    <>
      <p className="legal-lead">
        These terms cover your use of {APP_NAME}. By signing in you agree to them.
      </p>

      <h2>Not medical advice</h2>
      <p>
        {APP_NAME} gives general training guidance calculated from what you log. It is not medical
        advice and it does not know your full health picture. Talk to a doctor before starting or
        changing an exercise program — especially if you are pregnant, have a heart condition, an
        injury, or any condition that exercise could affect. Stop and seek help if you feel pain,
        dizziness or shortness of breath.
      </p>

      <h2>You train at your own risk</h2>
      <p>
        Strength training carries a risk of injury. You are responsible for choosing loads you can
        handle, using safe technique and equipment, and using a spotter or safeties where a lift
        calls for them. A suggested weight is a starting point for your judgment, never an
        instruction to override it.
      </p>

      <h2>Your account and your data</h2>
      <p>
        You need a Google or Apple account to sign in. What you log is yours: you can export it or
        delete it at any time from Settings. How it is handled is described in the{' '}
        <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2>Fair use</h2>
      <p>
        Don't try to access other people's data, disrupt the service, or use it to break the law.
        We may suspend an account that does.
      </p>

      <h2>The service</h2>
      <p>
        {APP_NAME} is provided as is, without warranties of any kind. We work to keep it accurate
        and available, but we can't promise it will be error-free or uninterrupted, and features
        may change. To the fullest extent the law allows, we are not liable for injury, loss of
        data or other damages arising from your use of the app. Nothing here limits rights you have
        under consumer law that cannot be waived.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms; this page always shows the current version and the date it
        changed. Continuing to use {APP_NAME} after a change means you accept the new terms.
      </p>

      <h2>Contact</h2>
      <Contact lead="Questions about these terms: write to" />
    </>
  );
}

function Support() {
  return (
    <>
      <p className="legal-lead">Quick answers first — and how to reach a person if they don't help.</p>

      <h2>Get in touch</h2>
      <Contact lead="For bugs, questions or feedback, write to" />
      <p>It helps to include the version shown at the bottom of this page and what you were doing.</p>

      <h2>My workouts aren't on my other device</h2>
      <p>
        Open Settings on both and check the sync line under your account. Tap <em>Sync now</em>. If
        it says your sign-in expired, sign in again — nothing logged in the meantime is lost; it
        uploads as soon as you are back in.
      </p>

      <h2>The app closed in the middle of a workout</h2>
      <p>
        Your sets are saved as you log them. Reopen the app and use <em>Resume unfinished
        workout</em> on the home screen.
      </p>

      <h2>Does it work without signal?</h2>
      <p>
        Yes. Logging, recommendations and history all work offline once you have signed in;
        everything syncs when you're back online.
      </p>

      <h2>How do I get a copy of my data?</h2>
      <p>Settings → Export my data saves every workout, your program and your plan as one file.</p>

      <h2>How do I delete my account?</h2>
      <p>
        Settings → Delete account. It removes your account and all training data from our servers
        and from that device, immediately and permanently. If you can't sign in to do it, write to
        us from the email address on the account and we will delete it for you.
      </p>

      <h2>More</h2>
      <p>
        <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Use</a>
      </p>
    </>
  );
}

const BODIES: Record<LegalDoc, () => ReactNode> = { privacy: Privacy, terms: Terms, support: Support };

export default function LegalView({ doc }: { doc: LegalDoc }) {
  const Body = BODIES[doc];
  return (
    <div className="legal-view">
      <header className="legal-header">
        <a className="back-btn" href="/" aria-label={`Back to ${APP_NAME}`}>&#8592;</a>
        <h1 className="legal-title">{TITLES[doc]}</h1>
      </header>
      <article className="legal-body">
        {doc !== 'support' && <p className="legal-updated">Last updated {LEGAL_UPDATED}</p>}
        <Body />
        <p className="legal-version">{versionLabel()}</p>
      </article>
    </div>
  );
}
