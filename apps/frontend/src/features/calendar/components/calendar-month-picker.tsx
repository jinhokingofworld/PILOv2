"use client";

import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  CALENDAR_MAX_YEAR,
  CALENDAR_MIN_YEAR,
  createCalendarMonthDate
} from "@/features/calendar/calendar-month-selection";

const calendarMonths = Array.from({ length: 12 }, (_, index) => ({
  label: `${index + 1}월`,
  value: String(index + 1)
}));

function formatMonthLabel(date: Date) {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
}

export function CalendarMonthPicker({
  monthDate,
  onMonthChange
}: {
  monthDate: Date;
  onMonthChange: (nextMonth: Date) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [year, setYear] = useState(String(monthDate.getFullYear()));
  const [month, setMonth] = useState(String(monthDate.getMonth() + 1));

  useEffect(() => {
    setYear(String(monthDate.getFullYear()));
    setMonth(String(monthDate.getMonth() + 1));
  }, [monthDate]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextYear = Number(year);
    const nextMonth = Number(month);
    const nextMonthDate = createCalendarMonthDate(nextYear, nextMonth);
    if (!nextMonthDate) {
      return;
    }

    onMonthChange(nextMonthDate);
    setIsOpen(false);
  }

  const monthLabel = formatMonthLabel(monthDate);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-w-32 px-3 text-base font-semibold"
            aria-label={`${monthLabel} 월 선택`}
          />
        }
      >
        {monthLabel}
      </PopoverTrigger>
      <PopoverContent align="center" className="w-64">
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div>
            <p className="font-medium text-foreground">이동할 연도와 월</p>
            <p className="mt-1 text-xs text-muted-foreground">
              원하는 달을 선택해 바로 이동합니다.
            </p>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
            <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
              연도
              <Input
                type="number"
                inputMode="numeric"
                min={CALENDAR_MIN_YEAR}
                max={CALENDAR_MAX_YEAR}
                value={year}
                aria-label="이동할 연도"
                onChange={(event) => setYear(event.currentTarget.value)}
              />
            </label>
            <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
              월
              <Select
                value={month}
                onValueChange={(value) => value && setMonth(value)}
              >
                <SelectTrigger className="w-full" aria-label="이동할 월">
                  <SelectValue>{month}월</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {calendarMonths.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
          <Button type="submit" className="w-full">
            이동
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
