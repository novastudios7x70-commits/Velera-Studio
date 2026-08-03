import Link from "next/link";
import { COMPANY } from "@/lib/company";

export function Footer() {
  return (
    <footer className="w-full border-t border-line mt-auto">
      <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-3 text-[12px] text-muted">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link href="/pricing" className="hover:text-text transition-colors">
            Pricing
          </Link>
          <Link href="/contact" className="hover:text-text transition-colors">
            Contact
          </Link>
          <Link href="/privacy" className="hover:text-text transition-colors">
            Privacy Policy
          </Link>
          <Link href="/terms" className="hover:text-text transition-colors">
            Terms of Service
          </Link>
          <a href={`mailto:${COMPANY.dmcaEmail}`} className="hover:text-text transition-colors">
            DMCA
          </a>
        </div>
        <div>
          {COMPANY.legalName} · {COMPANY.physicalAddress}
        </div>
        <div>© {new Date().getFullYear()} {COMPANY.legalName}. All rights reserved.</div>
      </div>
    </footer>
  );
}
