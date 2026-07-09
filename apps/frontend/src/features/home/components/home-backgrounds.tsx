export function CalendarBackground() {
  return (
    <>
      <div className="absolute inset-0 bg-[#F4FBFA]" />
      <div className="absolute inset-x-0 top-0 h-1 bg-[#2EC4B6]" />
      <div className="absolute inset-x-6 top-16 grid grid-cols-7 gap-2 opacity-35">
        {Array.from({ length: 14 }, (_, item) => (
          <span
            key={item}
            className="h-5 rounded border border-[#B7DCD7] bg-white/50"
          />
        ))}
      </div>
      <div className="absolute right-7 top-8 grid grid-cols-4 gap-2 opacity-25">
        {Array.from({ length: 16 }, (_, item) => (
          <span key={item} className="size-1 rounded-full bg-[#0F766E]" />
        ))}
      </div>
      <div className="absolute inset-0 shadow-[inset_0_-18px_30px_rgba(15,23,42,0.055)]" />
    </>
  );
}

export function MeetingReportsBackground() {
  return (
    <>
      <div className="absolute inset-0 bg-[#F5FCF2]" />
      <div className="absolute inset-x-0 top-0 h-1 bg-[#2DB400]" />
      <div className="absolute right-5 top-6 h-24 w-28 rotate-2 rounded-lg border border-[#CBEFBD] bg-white/55 shadow-sm" />
      <div className="absolute right-9 top-11 h-1.5 w-16 rounded-full bg-[#2DB400]/35" />
      <div className="absolute right-9 top-[3.75rem] h-1.5 w-20 rounded-full bg-[#2DB400]/22" />
      <div className="absolute right-9 top-[5.25rem] h-1.5 w-14 rounded-full bg-[#2DB400]/18" />
      <div className="absolute left-6 top-24 grid grid-cols-4 gap-2 opacity-18">
        {Array.from({ length: 16 }, (_, item) => (
          <span key={item} className="size-1 rounded-full bg-[#1F7A00]" />
        ))}
      </div>
      <div className="absolute inset-0 shadow-[inset_0_-18px_30px_rgba(15,23,42,0.055)]" />
    </>
  );
}

export function IssuesBackground() {
  return (
    <>
      <div className="absolute inset-0 bg-[#F7F5FF]" />
      <div className="absolute inset-x-0 top-0 h-1 bg-[#9986F4]" />
      <div className="absolute right-6 top-7 grid gap-2 opacity-35">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="flex items-center gap-2">
            <span className="size-3 rounded border border-[#D8D1FF] bg-white/65" />
            <span className="h-1.5 w-20 rounded-full bg-[#9986F4]/35" />
          </div>
        ))}
      </div>
      <div className="absolute left-6 top-20 grid grid-cols-4 gap-2 opacity-20">
        {Array.from({ length: 16 }, (_, item) => (
          <span key={item} className="size-1 rounded-full bg-[#5B4BC4]" />
        ))}
      </div>
      <div className="absolute inset-0 shadow-[inset_0_-18px_30px_rgba(15,23,42,0.055)]" />
    </>
  );
}

export function PullRequestsBackground() {
  return (
    <>
      <div className="absolute inset-0 bg-[#F5F6FF]" />
      <div className="absolute inset-x-0 top-0 h-1 bg-[#000080]" />
      <div className="absolute right-4 top-6 grid w-28 gap-1.5 opacity-35">
        <div className="h-1.5 rounded-full bg-[#000080]/45" />
        <div className="h-1.5 w-20 rounded-full bg-[#000080]/25" />
        <div className="h-1.5 w-24 rounded-full bg-[#000080]/30" />
        <div className="h-1.5 w-16 rounded-full bg-[#000080]/20" />
      </div>
      <div className="absolute left-7 top-20 h-px w-28 rotate-[-8deg] bg-[#000080]/25" />
      <div className="absolute left-8 top-[5.35rem] size-2.5 rounded-full bg-[#000080]/30" />
      <div className="absolute right-12 top-[4.4rem] size-2.5 rounded-full bg-[#000080]/20" />
      <div className="absolute inset-0 shadow-[inset_0_-18px_30px_rgba(15,23,42,0.055)]" />
    </>
  );
}

export function SummaryCalendarBackground() {
  return (
    <>
      <div className="absolute inset-0 bg-[#F4FBFA]" />
      <div className="absolute inset-y-0 left-0 w-1 bg-[#2EC4B6]" />
      <div className="absolute inset-0 shadow-[inset_0_-14px_24px_rgba(15,23,42,0.055)]" />
    </>
  );
}

export function SummaryIssuesBackground() {
  return (
    <>
      <div className="absolute inset-0 bg-[#F7F5FF]" />
      <div className="absolute inset-y-0 left-0 w-1 bg-[#9986F4]" />
      <div className="absolute inset-0 shadow-[inset_0_-14px_24px_rgba(15,23,42,0.045)]" />
    </>
  );
}

export function SummaryPullRequestsBackground() {
  return (
    <>
      <div className="absolute inset-0 bg-[#F5F6FF]" />
      <div className="absolute inset-y-0 left-0 w-1 bg-[#000080]" />
      <div className="absolute inset-0 shadow-[inset_0_-14px_24px_rgba(15,23,42,0.045)]" />
    </>
  );
}

export function SummaryMeetingReportsBackground() {
  return (
    <>
      <div className="absolute inset-0 bg-[#F5FCF2]" />
      <div className="absolute inset-y-0 left-0 w-1 bg-[#2DB400]" />
      <div className="absolute inset-0 shadow-[inset_0_-14px_24px_rgba(15,23,42,0.045)]" />
    </>
  );
}
