import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { COMPANY } from "@/lib/company";

export const metadata = { title: "Terms of Service — Velora Studio" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="nova-display font-semibold text-[16px] text-text mb-2.5">{title}</h2>
      <div className="text-[13.5px] text-muted leading-relaxed flex flex-col gap-3">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <div className="nova-fade-in max-w-2xl mx-auto px-6 py-14 w-full">
      <Link href="/" className="flex items-center gap-1 mb-8 text-muted text-[13px]">
        <ArrowLeft size={14} /> back
      </Link>
      <h1 className="nova-display font-semibold text-[26px] text-text mb-2">Terms of Service</h1>
      <p className="text-[12.5px] text-muted mb-10">Last updated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>

      <Section title="1. Your content">
        <p>
          You keep ownership of everything you upload. By uploading content, you affirm that you own it or
          have all necessary rights and permissions to upload it and to have Velora Studio process it and
          generate derivative clips from it. You agree to indemnify and hold Velora Studio harmless from
          any claim, damage, or expense (including reasonable legal fees) arising from content you upload
          that infringes a third party&apos;s rights.
        </p>
        <p>
          We don&apos;t review uploads before processing. If your account is repeatedly associated with
          infringing content, we may suspend or terminate it.
        </p>
      </Section>

      <Section title="2. Copyright complaints (DMCA)">
        <p>
          Velora Studio responds to valid takedown notices under the Digital Millennium Copyright Act. If
          you believe content processed or hosted through Velora Studio infringes your copyright, send a
          notice to our designated agent at{" "}
          <a className="text-text underline underline-offset-2" href={`mailto:${COMPANY.dmcaEmail}`}>{COMPANY.dmcaEmail}</a> including:
        </p>
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li>A description of the copyrighted work you claim is infringed.</li>
          <li>The URL or other specific location of the material on our service.</li>
          <li>Your contact information (name, address, phone, email).</li>
          <li>A statement that you have a good-faith belief the use is unauthorized.</li>
          <li>A statement, under penalty of perjury, that the notice is accurate and you&apos;re authorized to act on the copyright owner&apos;s behalf.</li>
          <li>Your physical or electronic signature.</li>
        </ul>
        <p>
          We remove or disable access to material identified in a valid notice and notify the affected
          user, who may submit a counter-notice as provided under the DMCA.
        </p>
      </Section>

      <Section title="3. Plans, billing &amp; cancellation">
        <p>
          The free trial gives you 3 clips with no time limit — no credit card required. Paid plans renew
          monthly at the price shown at checkout, charged to the payment method on file, until you cancel.
        </p>
        <p>
          You can cancel anytime from Settings → Manage billing — cancellation takes effect at the end of
          your current billing period and you won&apos;t be charged again. We&apos;ll send you a confirmation email
          when you cancel. We do not require you to contact support to cancel.
        </p>
      </Section>

      <Section title="4. Acceptable use">
        <p>
          Don&apos;t use Velora Studio to process content that is illegal, that you don&apos;t have rights to, or
          that&apos;s intended to harass, defraud, or impersonate someone without their consent. We may suspend
          accounts that violate this.
        </p>
      </Section>

      <Section title="5. Service &amp; disclaimers">
        <p>
          Velora Studio is provided &ldquo;as is.&rdquo; Processing quality depends on third-party services
          (transcription, visual generation, language models) we don&apos;t control, and outputs may occasionally
          be inaccurate or unusable. To the extent permitted by law, our liability for any claim related to
          the service is limited to the amount you paid us in the 3 months before the claim arose.
        </p>
      </Section>

      <Section title="6. Changes">
        <p>
          We may update these terms as the product evolves. We&apos;ll post the updated date at the top of this
          page; material changes will also be emailed to active subscribers.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          {COMPANY.legalName}, {COMPANY.physicalAddress} —{" "}
          <a className="text-text underline underline-offset-2" href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a>.
        </p>
      </Section>
    </div>
  );
}
