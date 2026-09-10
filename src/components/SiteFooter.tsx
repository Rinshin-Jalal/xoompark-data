import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="border-t border-[#0e1c36]/10 bg-[#f9fbf2] px-5 py-10 sm:px-10">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-8 sm:flex-row sm:justify-between">
        {/* Left */}
        <div>
          <Link href="/" className="xp-logo text-[#0e1c36]">XOOMPARK<span>®</span></Link>
          <p className="mt-3 max-w-xs text-[12px] leading-5 text-[#0e1c36]/50">
            Distributed pit stops for autonomous fleets.
          </p>
          <p className="mt-3 text-[11px] leading-4 text-[#0e1c36]/40">
            Operating in Miami · Contracted in San Francisco<br />
            Sourcing Nashville, Phoenix, Austin, Las Vegas
          </p>
        </div>

        {/* Right */}
        <div className="flex flex-col gap-6 sm:flex-row sm:gap-12">
          {/* Pit Stops */}
          <div>
            <h3 className="mb-2 font-mono text-[10px] font-semibold tracking-[.2em] text-[#0e1c36]/40 uppercase">Pit Stops</h3>
            <ul className="space-y-1 text-[12px] text-[#0e1c36]/55">
              <li>Charging</li>
              <li>Cleaning</li>
              <li>Light Service</li>
            </ul>
          </div>

          {/* Links */}
          <div>
            <h3 className="mb-2 font-mono text-[10px] font-semibold tracking-[.2em] text-[#0e1c36]/40 uppercase">Navigate</h3>
            <ul className="space-y-1 text-[12px]">
              <li><Link href="/#network" className="text-[#0e1c36]/55 hover:text-[#0e1c36]">Network</Link></li>
              <li><Link href="/#partners" className="text-[#0e1c36]/55 hover:text-[#0e1c36]">Partners</Link></li>
              <li><Link href="/auth" className="text-[#0e1c36]/55 hover:text-[#0e1c36]">Fleet Access</Link></li>
              <li><Link href="/dashboard/operator/api-docs" className="text-[#0e1c36]/55 hover:text-[#0e1c36]">API</Link></li>
            </ul>
          </div>
        </div>
      </div>

      <div className="mx-auto mt-8 max-w-[1280px] border-t border-[#0e1c36]/10 pt-5 text-[10px] tracking-[.15em] text-[#0e1c36]/35">
        © {new Date().getFullYear()} XOOMPARK INC. · <a href="mailto:greg@xoompark.co" className="hover:text-[#0e1c36]/60">greg@xoompark.co</a>
      </div>
    </footer>
  );
}
