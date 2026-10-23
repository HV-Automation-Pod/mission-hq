import { CalendarCheck, Globe, Info, LayoutGrid, Lock } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";

/**
 * The member loading screen: the real shell with the content still to come.
 *
 * The sidebar and heading are the actual ones, so the page does not rearrange
 * itself when data lands; only the grey blocks fill in. Same palette as
 * `MemberView` (Petrol & Oat), and light only, because it shows before the
 * theme is known.
 *
 * Plain markup, no hooks: it renders on the server too, so it is on screen
 * before any script has run.
 */
const C = { canvas: "#F7F8F5", surface: "#FFFFFF", text: "#172B2C", text2: "#536467", muted: "#65767A", border: "#DDE5E2", primary: "#125B60", selected: "#E9F3F1", bar: "#E3EAE7", barSoft: "#EEF1EF" };

const NAV = [
  { label: "Overview", Icon: LayoutGrid, on: true },
  { label: "My attendance", Icon: CalendarCheck },
  { label: "Policies", Icon: Info },
  { label: "Allowances", Icon: Globe },
];

/** One grey block. `soft` is the lighter tone used for the larger areas. */
function Bar({ w, h = 12, soft = false, className = "" }: { w?: number | string; h?: number; soft?: boolean; className?: string }) {
  return <div className={`rounded-md animate-pulse motion-reduce:animate-none ${className}`} style={{ width: w, height: h, background: soft ? C.barSoft : C.bar }} />;
}

function Box({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl p-5 sm:p-6 ${className}`} style={{ background: C.surface, border: `1px solid ${C.border}`, boxShadow: "0 1px 2px 0 rgb(0 0 0 / 4%), 0 2px 4px 0 rgb(0 0 0 / 2%)" }}>{children}</div>;
}

export default function MemberLoading() {
  return (
    <div className="min-h-dvh" role="status" aria-busy="true" aria-label="Getting your workspace ready"
      style={{ background: C.canvas, color: C.text, fontFamily: "var(--font-geist), system-ui, sans-serif" }}>

      {/* Sidebar (desktop) */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-[232px] flex-col" style={{ borderRight: `1px solid ${C.border}` }}>
        <div className="flex items-center gap-3 px-6 pt-7 pb-8">
          <BrandMark size={40} />
          <div>
            <div className="text-[19px] font-semibold leading-tight tracking-tight">MissionHQ</div>
            <div className="text-[10px] tracking-[0.18em]" style={{ color: C.muted }}>HYPERVERGE</div>
          </div>
        </div>
        <div className="px-6 pb-3 text-[11px] tracking-[0.14em]" style={{ color: C.muted }}>MY WORKSPACE</div>
        <nav className="px-3 space-y-1">
          {NAV.map(({ label, Icon, on }) => (
            <div key={label} className="relative flex items-center gap-3 px-3.5 h-11 rounded-xl text-[14px] font-medium"
              style={on ? { background: C.selected, color: C.text } : { color: C.text2 }}>
              {on && <span className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r" style={{ background: C.primary }} />}
              <Icon size={18} /> {label}
            </div>
          ))}
        </nav>
        <div className="mt-auto p-3">
          <div className="rounded-2xl p-4" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-2 text-[13px] font-medium"><Lock size={14} /> Your own record</div>
            <p className="text-[12px] mt-1.5 leading-snug" style={{ color: C.muted }}>Attendance and balances, in one personal view.</p>
          </div>
        </div>
      </aside>

      {/* Top bar (phone) */}
      <header className="lg:hidden flex items-center gap-3 px-5 h-16" style={{ borderBottom: `1px solid ${C.border}` }}>
        <BrandMark size={34} />
        <div>
          <div className="text-[15px] font-semibold leading-tight">MissionHQ</div>
          <div className="text-[9px] tracking-[0.18em]" style={{ color: C.muted }}>HYPERVERGE</div>
        </div>
      </header>

      <div className="lg:pl-[232px]">
        <main className="mx-auto max-w-[1168px] px-5 lg:px-10 pt-6 lg:pt-8 pb-16">
          <div className="mb-6 lg:mb-8 flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] tracking-[0.14em] mb-3" style={{ color: C.muted }}>MY WORKSPACE / OVERVIEW</div>
              <h1 className="text-[34px] lg:text-[32px] font-semibold leading-tight tracking-tight">Getting your workspace ready</h1>
              <p className="text-[14px] mt-3" style={{ color: C.text2 }}>Loading your attendance, balances and policies.</p>
            </div>
            <span className="hidden sm:inline-flex items-center gap-2 text-[12px] px-3 h-8 rounded-full flex-shrink-0" style={{ background: C.selected, color: C.primary }}>
              <Lock size={12} /> Loading securely
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
            <div className="space-y-6 min-w-0">
              {/* Today */}
              <Box className="flex items-center gap-4">
                <Bar w={56} h={56} className="!rounded-2xl flex-shrink-0" />
                <div className="flex-1 space-y-3"><Bar w={70} h={10} soft /><Bar w="55%" h={22} /><Bar w="75%" h={10} soft /></div>
                <Bar w={150} h={44} className="hidden sm:block !rounded-[10px]" />
              </Box>

              {/* Calendar */}
              <Box>
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-3"><Bar w={170} h={20} /><Bar w={110} h={10} soft /></div>
                  <div className="flex gap-2"><Bar w={96} h={34} /><Bar w={64} h={40} /><Bar w={40} h={40} /><Bar w={40} h={40} /></div>
                </div>
                <div className="flex gap-2 mt-4"><Bar w={72} h={26} className="!rounded-full" /><Bar w={72} h={26} className="!rounded-full" /><Bar w={72} h={26} className="!rounded-full" /></div>
                <div className="grid grid-cols-5 gap-2 mt-6 mb-2">{Array.from({ length: 5 }, (_, i) => <Bar key={i} w={32} h={9} soft />)}</div>
                <div className="space-y-2">
                  {Array.from({ length: 4 }, (_, r) => (
                    <div key={r} className="grid grid-cols-5 gap-2">
                      {Array.from({ length: 5 }, (_, c) => <Bar key={c} h={76} soft className="!rounded-xl !w-full" />)}
                    </div>
                  ))}
                </div>
              </Box>
            </div>

            <div className="space-y-6 min-w-0">
              <Box><Bar w={86} h={22} className="!rounded-full" /><Bar w="60%" h={20} className="mt-4" /><Bar w="85%" h={10} soft className="mt-3" />
                <div className="flex gap-2 mt-4"><Bar w={64} h={36} soft /><Bar w={64} h={36} soft /><Bar w={64} h={36} soft /></div><Bar h={40} soft className="mt-4 !w-full !rounded-[10px]" /></Box>
              <Box><Bar w={90} h={18} /><Bar w={110} h={10} soft className="mt-3" />
                <div className="flex items-center gap-4 mt-5"><Bar w={96} h={42} /><div className="flex-1 space-y-2"><Bar h={10} soft className="!w-full" /><Bar w="70%" h={10} soft /></div></div>
                <Bar h={8} soft className="mt-4 !w-full !rounded-full" /></Box>
              <Box><Bar w={150} h={16} /><Bar w={90} h={38} className="mt-5" /><Bar h={8} soft className="mt-4 !w-full !rounded-full" /><Bar w="45%" h={10} soft className="mt-3" /></Box>
            </div>
          </div>

          <p className="text-[12px] mt-8" style={{ color: C.muted }}>Your latest records will appear here as soon as they are ready.</p>
        </main>
      </div>
    </div>
  );
}
