import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { COMPANY } from "@/lib/company";

export const metadata = { title: "Privacy Policy — Velora Studio" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="nova-display font-semibold text-[16px] text-text mb-2.5">{title}</h2>
      <div className="text-[13.5px] text-muted leading-relaxed flex flex-col gap-3">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="nova-fade-in max-w-2xl mx-auto px-6 py-14 w-full">
      <Link href="/" className="flex items-center gap-1 mb-8 text-muted text-[13px]">
        <ArrowLeft size={14} /> back
      </Link>
      <h1 className="nova-display font-semibold text-[26px] text-text mb-2">Privacy Policy</h1>
      <p className="text-[12.5px] text-muted mb-10">Last updated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>

      <Section title="What we collect">
        <p>
          When you create an account we collect your email address, a password (stored hashed by our
          authentication provider, never in plain text), and any display name or brand color you set in
          Settings.
        </p>
        <p>
          When you use the product, we collect the audio/video files you upload, the transcripts and
          analysis we generate from them, and the clips we produce. We also collect basic billing
          information if you subscribe to a paid plan (handled by Stripe — we never see or store your
          full card number).
        </p>
      </Section>

      <Section title="Third parties we share data with">
        <p>Processing your upload requires sharing it, or data derived from it, with:</p>
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li><b className="text-text">AssemblyAI</b> — transcribes spoken-word uploads.</li>
          <li><b className="text-text">Higgsfield</b> — generates visuals when you choose &ldquo;generate for me&rdquo; (only if that feature is enabled).</li>
          <li><b className="text-text">Anthropic</b> — powers the model that selects hook-worthy moments from your transcript or audio analysis.</li>
          <li><b className="text-text">Stripe</b> — processes payments and manages subscriptions.</li>
          <li><b className="text-text">Supabase</b> — hosts our database, authentication, and file storage.</li>
        </ul>
        <p>We do not sell your personal data or your uploaded content to anyone.</p>
      </Section>

      <Section title="How long we keep it">
        <p>
          Uploaded files and generated clips are retained for as long as your account is active so you can
          keep downloading them. If you delete your account, we delete your uploads, transcripts, and
          clips within 30 days, except where we&apos;re required to retain billing records for tax/accounting
          purposes.
        </p>
      </Section>

      <Section title="Your rights (CCPA/CPRA, GDPR)">
        <p>
          Depending on where you live, you may have the right to access, correct, export, or delete your
          personal data, and to opt out of any marketing communications. To exercise any of these rights,
          email <a className="text-violet" href={`mailto:${COMPANY.privacyEmail}`}>{COMPANY.privacyEmail}</a> —
          we&apos;ll respond within the timeframe required by applicable law.
        </p>
        <p>
          You can unsubscribe from marketing emails at any time using the link in any marketing email, or
          by turning off &ldquo;Product updates &amp; tips&rdquo; in Settings. Transactional emails (receipts,
          processing notifications, cancellation confirmations) aren&apos;t marketing and can&apos;t be turned off
          while your account is active.
        </p>
      </Section>

      <Section title="Content you upload">
        <p>
          You retain ownership of everything you upload. We process it solely to generate the clips you
          asked for and don&apos;t use your content to train third-party models beyond what&apos;s necessary to run
          that processing (e.g. passing your audio to AssemblyAI for transcription).
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about this policy: <a className="text-violet" href={`mailto:${COMPANY.privacyEmail}`}>{COMPANY.privacyEmail}</a>.
          {" "}{COMPANY.legalName}, {COMPANY.physicalAddress}.
        </p>
      </Section>
    </div>
  );
}
