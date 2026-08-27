const bangkokOffsetMilliseconds = 7 * 60 * 60 * 1000;

function getMonthCoordinates(year: number, monthIndex: number) {
  const date = new Date(Date.UTC(year, monthIndex, 1));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
  };
}

function monthStartInBangkok(year: number, month: number) {
  return new Date(
    `${year}-${String(month).padStart(2, "0")}-01T00:00:00+07:00`,
  );
}

export function getDashboardMonthRange(periodMonth: string) {
  const [year, month] = periodMonth.split("-").map(Number);
  const next = getMonthCoordinates(year, month);
  return {
    since: monthStartInBangkok(year, month),
    until: monthStartInBangkok(next.year, next.month),
  };
}

export function getDashboardReportingPeriod(periodMonth: string) {
  const [year, month] = periodMonth.split("-").map(Number);
  const first = getMonthCoordinates(year, month - 6);
  const months = Array.from({ length: 6 }, (_, offset) => {
    const item = getMonthCoordinates(first.year, first.month - 1 + offset);
    return `${item.year}-${String(item.month).padStart(2, "0")}`;
  });
  const { until } = getDashboardMonthRange(periodMonth);
  return {
    months,
    since: monthStartInBangkok(first.year, first.month),
    until,
  };
}

export function getBangkokPeriodMonth(timestamp: string) {
  const bangkokDate = new Date(
    new Date(timestamp).getTime() + bangkokOffsetMilliseconds,
  );
  return `${bangkokDate.getUTCFullYear()}-${String(
    bangkokDate.getUTCMonth() + 1,
  ).padStart(2, "0")}`;
}
