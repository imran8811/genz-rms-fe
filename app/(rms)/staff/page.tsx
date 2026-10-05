"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

// ─── Types ────────────────────────────────────────────────────────────────────

type Role             = "Manager" | "Chef" | "Cashier" | "Rider" | "Waiter" | "Helper";
type Tab              = "staff" | "attendance" | "leaves" | "advances" | "fines" | "food" | "payroll";
/**
 * Three statuses. There is **no `late`**: someone late was always *present*,
 * and the arrival time in `check_in_time` is what records it. The status existed
 * because attendance marking used to charge a fine by itself and needed to show
 * that it had fired; fines are charged by hand now.
 */
type AttendanceStatus = "present" | "absent" | "half_day";
type LeaveType        = "sick" | "casual" | "annual" | "unpaid";

interface StaffMember {
  id: number; name: string; role: Role; phone: string | null;
  salary: number; join_date: string | null; is_active: boolean; shift: string | null;
}

interface AttendanceRecord {
  id?: number; staff_id: number; date: string;
  status: AttendanceStatus; check_in_time: string | null;
  staff?: { id: number; name: string; role: string };
}

interface LeaveRecord {
  id: number; staff_id: number; leave_type: LeaveType;
  start_date: string; end_date: string; days_count: number;
  reason: string | null; notes: string | null;
  staff?: { id: number; name: string; role: string };
}

interface AdvanceRecord {
  id: number; staff_id: number; amount: number;
  given_date: string; repayment_month: string;
  reason: string | null; notes: string | null;
  staff?: { id: number; name: string; role: string };
}

interface FineRecord {
  id: number; staff_id: number; amount: number; fine_date: string;
  // The row also carries `minutes_late`; nothing reads it since the Late Fine
  // column stopped reporting lateness, so it isn't modelled.
  source: "auto_late" | "manual";
  reason: string | null; notes: string | null;
  staff?: { id: number; name: string; role: string };
}

/** The late-fine rule, read from the backend so the two never drift apart. */
// `GET /staff-fines/rule` also returns `grace_minutes` and `default_shift_start`;
// neither is read any more, so neither is modelled here.
interface FineRule { amount: number }

/**
 * Force `staff_id` to a number on the way in.
 *
 * The attendance screen matches a fine to its row by identity
 * (`f.staff_id === s.id`), and `staff_id` is only as typed as the database
 * driver feels like making it — a string gets through under some PDO setups.
 * That match then fails silently: a person who **has** been fined still shows an
 * "Add fine" link, and pressing it charges them a second time. The backend casts
 * the column too; this keeps the screen right against an API that hasn't been
 * redeployed yet, and is the one place the whole tab ingests fines.
 */
const normalizeFines = (rows: FineRecord[]): FineRecord[] =>
  rows.map((f) => ({ ...f, staff_id: Number(f.staff_id) }));

interface FoodLogEntry {
  id: number; staff_id: number; item_name: string;
  quantity: number; unit_price: number; total_amount: number;
  consumed_at: string; notes: string | null;
  staff?: { id: number; name: string; role: string };
}

interface StaffSummaryRow {
  staff_id: number; staff_name: string; role: string;
  salary: number; total: number; entries: FoodLogEntry[];
}

interface MonthlySummary {
  month: string; total: number; by_staff: StaffSummaryRow[];
}

interface PayrollRow {
  staff_id: number; staff_name: string; role: string;
  // Optional: an API older than the Status column omits it, and "unknown" must
  // not render as "Inactive" on a payroll sheet.
  is_active?: boolean;
  base_salary: number; daily_rate: number;
  present_days: number; absent_days: number; half_days: number;
  absent_deduct: number; half_day_deduct: number;
  food_deduct: number; advance_deduct: number; fine_deduct: number;
  total_deductions: number; net_payable: number;
}

interface PayrollSummary {
  month: string; working_days: number;
  total_base_salary: number; total_payable: number;
  staff: PayrollRow[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLES: Array<Role | "All"> = ["All", "Manager", "Chef", "Cashier", "Rider", "Waiter", "Helper"];

const ROLE_COLORS: Record<Role, string> = {
  Manager: "bg-purple-100 text-purple-700", Chef:    "bg-orange-100 text-orange-700",
  Cashier: "bg-blue-100 text-blue-700",     Rider:   "bg-green-100 text-green-700",
  Waiter:  "bg-teal-100 text-teal-700",     Helper:  "bg-gray-100 text-gray-600",
};

const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  present: "Present", absent: "Absent", half_day: "Half Day",
};

const ATTENDANCE_COLORS: Record<AttendanceStatus, string> = {
  present:  "bg-green-100 text-green-700",
  absent:   "bg-red-100 text-red-700",
  half_day: "bg-yellow-100 text-yellow-700",
};

// History rows written before `late` was dropped still carry it until the
// conversion migration has run, and an unknown key would render a blank badge.
// Read-only display only — the editable dropdown offers the three real statuses.
const attendanceLabel = (st: AttendanceStatus) => ATTENDANCE_LABELS[st] ?? st;
const attendanceColor = (st: AttendanceStatus) => ATTENDANCE_COLORS[st] ?? "bg-gray-100 text-gray-600";

const LEAVE_LABELS: Record<LeaveType, string> = {
  sick: "Sick", casual: "Casual", annual: "Annual", unpaid: "Unpaid",
};

const LEAVE_COLORS: Record<LeaveType, string> = {
  sick:   "bg-red-100 text-red-700",    casual: "bg-blue-100 text-blue-700",
  annual: "bg-green-100 text-green-700", unpaid: "bg-gray-100 text-gray-600",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) { return "Rs " + n.toLocaleString("en-PK"); }
// Dates here are calendar days in the restaurant's own timezone, so they must be
// formatted from the *local* parts: toISOString() converts to UTC first, which in
// PKT (UTC+5) rolls a local midnight back to the previous day.
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayStr()        { return ymd(new Date()); }
function currentMonthStr() { return ymd(new Date()).slice(0, 7); }
function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * The restaurant's one and only shift. There is no second shift, no "Full Day"
 * and no "Morning": `staff.shift` is a label every row carries the same value
 * of. Purely a display string — nothing is computed from it.
 */
const THE_SHIFT = "1PM–1AM";

/**
 * Used if `GET /staff-fines/rule` can't be reached, so Add fine still quotes a
 * number. **This screen no longer does any lateness arithmetic**: it had a
 * `minutesLate()` / `shiftStartMinutes()` / `toMinutes()` trio mirroring
 * `LateFineService`, which drove the "31 min late" preview and sorted a typed
 * time into Present vs Late. Both are gone — the preview was removed, and `late`
 * is no longer a status — so the whole mirror went with them. The backend
 * decides what a fine costs; this only needs the amount to put on the button.
 */
const FALLBACK_RULE: FineRule = { amount: 200 };

function LoadingRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
      ))}
    </tr>
  );
}

// ─── Empty form defaults ──────────────────────────────────────────────────────

const emptyStaffForm   = { name: "", role: "Cashier" as Role, phone: "", shift: THE_SHIFT, salary: "", join_date: "", is_active: true };
const emptyLeaveForm   = { staff_id: "", leave_type: "casual" as LeaveType, start_date: "", end_date: "", reason: "", notes: "" };
const emptyAdvanceForm = { staff_id: "", amount: "", given_date: todayStr(), repayment_month: currentMonthStr(), reason: "", notes: "" };
const emptyFoodForm    = () => ({ staff_id: "", item_name: "", quantity: "1", unit_price: "", consumed_at: todayStr(), notes: "", added_by: "" });
const emptyFineForm    = (amount: number) => ({ staff_id: "", amount: String(amount), fine_date: todayStr(), reason: "", notes: "" });

// ─── Main Component ───────────────────────────────────────────────────────────

export default function StaffPage() {

  // ── Shared ──
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  // Staff & Payroll tabs hold salary data — admins only.
  const [activeTab, setActiveTab]       = useState<Tab>(isAdmin ? "staff" : "attendance");

  // Keep non-admins off the admin-only tabs (e.g. if role resolves after mount).
  useEffect(() => {
    if (!isAdmin && (activeTab === "staff" || activeTab === "payroll")) {
      setActiveTab("attendance");
    }
  }, [isAdmin, activeTab]);
  const [staff, setStaff]               = useState<StaffMember[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);
  const [error, setError]               = useState<string | null>(null);

  // ── Staff tab ──
  const [roleFilter, setRoleFilter]         = useState<Role | "All">("All");
  const [showStaffForm, setShowStaffForm]   = useState(false);
  const [editMember, setEditMember]         = useState<StaffMember | null>(null);
  const [staffForm, setStaffForm]           = useState({ ...emptyStaffForm });
  const [staffSaving, setStaffSaving]       = useState(false);
  const [deleteStaffId, setDeleteStaffId]   = useState<number | null>(null);

  // ── Attendance tab ──
  const [attendanceDate, setAttendanceDate]         = useState(todayStr());
  const [attendanceMap, setAttendanceMap]           = useState<Record<number, { status: AttendanceStatus; check_in_time: string }>>({});
  const [attendanceLoading, setAttendanceLoading]   = useState(false);
  const [attendanceSaving, setAttendanceSaving]     = useState(false);
  // Late fines standing on the shown day **as the server has them**. Fetched for
  // the date rather than read out of a save's response, and re-read after one.
  const [dayFines, setDayFines]                     = useState<FineRecord[]>([]);
  // Fine changes the manager has made on screen but not saved yet, keyed by
  // staff id: `true` = charge this one on save, `false` = take it back off on
  // save. A staff id that isn't here has no pending change. Add/Remove only
  // write *here* — nothing reaches the API until Save Attendance is pressed, so
  // the whole sheet, times and fines together, commits in one action.
  const [fineIntent, setFineIntent]                 = useState<Record<number, boolean>>({});
  // Set after a successful save, purely as confirmation — there is no longer a
  // list of charges to report, because a save makes none.
  const [attendanceSaved, setAttendanceSaved]       = useState<string | null>(null);
  // Ticks each minute so the "stamps 17:30 on save" hint under a blank time box
  // keeps naming the time a save would actually write.
  const [clockTick, setClockTick]                   = useState(() => new Date());
  // Status as the server last stored it, per staff id (absent from the map =
  // no record yet). Only someone *not* already marked in gets stamped on save,
  // so the preview has to know the difference between "present since 1pm, no
  // time recorded" and "being marked in right now".
  const [savedStatus, setSavedStatus]               = useState<Record<number, AttendanceStatus>>({});
  const [historyRecords, setHistoryRecords]         = useState<AttendanceRecord[]>([]);
  const [historyLoading, setHistoryLoading]         = useState(false);
  const [historyPage, setHistoryPage]               = useState(-1);

  // ── Leaves tab ──
  const [leaves, setLeaves]                     = useState<LeaveRecord[]>([]);
  const [leavesLoading, setLeavesLoading]       = useState(false);
  const [leavesMonth, setLeavesMonth]           = useState(currentMonthStr());
  const [showLeaveForm, setShowLeaveForm]       = useState(false);
  const [leaveForm, setLeaveForm]               = useState({ ...emptyLeaveForm });
  const [leaveSaving, setLeaveSaving]           = useState(false);

  // ── Advances tab ──
  const [advances, setAdvances]                     = useState<AdvanceRecord[]>([]);
  const [advancesLoading, setAdvancesLoading]       = useState(false);
  const [advancesMonth, setAdvancesMonth]           = useState(currentMonthStr());
  const [showAdvanceForm, setShowAdvanceForm]       = useState(false);
  const [advanceForm, setAdvanceForm]               = useState({ ...emptyAdvanceForm });
  const [advanceSaving, setAdvanceSaving]           = useState(false);

  // ── Fines tab ──
  const [fineRule, setFineRule]             = useState<FineRule>(FALLBACK_RULE);
  const [fines, setFines]                   = useState<FineRecord[]>([]);
  const [finesLoading, setFinesLoading]     = useState(false);
  const [finesMonth, setFinesMonth]         = useState(currentMonthStr());
  const [finesStaffFilter, setFinesStaffFilter] = useState("");
  const [showFineForm, setShowFineForm]     = useState(false);
  const [editFine, setEditFine]             = useState<FineRecord | null>(null);
  const [fineForm, setFineForm]             = useState(emptyFineForm(FALLBACK_RULE.amount));
  const [fineSaving, setFineSaving]         = useState(false);
  const [fineFormError, setFineFormError]   = useState("");
  const [fineDeleteId, setFineDeleteId]     = useState<number | null>(null);

  // ── Food tab ──
  const [foodLogs, setFoodLogs]                       = useState<FoodLogEntry[]>([]);
  const [foodLogsLoading, setFoodLogsLoading]         = useState(false);
  const [foodFilterStaff, setFoodFilterStaff]         = useState("");
  const [foodReportMonth, setFoodReportMonth]         = useState(currentMonthStr());
  const [foodSummary, setFoodSummary]                 = useState<MonthlySummary | null>(null);
  const [foodSummaryLoading, setFoodSummaryLoading]   = useState(false);
  const [expandedFoodStaff, setExpandedFoodStaff]     = useState<Set<number>>(new Set());
  const [showFoodModal, setShowFoodModal]             = useState(false);
  const [foodForm, setFoodForm]                       = useState(emptyFoodForm());
  const [foodFormError, setFoodFormError]             = useState("");
  const [foodSaving, setFoodSaving]                   = useState(false);
  const [foodDeleteId, setFoodDeleteId]               = useState<number | null>(null);

  // ── Payroll tab ──
  const [payrollMonth, setPayrollMonth]     = useState(currentMonthStr());
  const [workingDays, setWorkingDays]       = useState(30);
  const [payroll, setPayroll]               = useState<PayrollSummary | null>(null);
  const [payrollLoading, setPayrollLoading] = useState(false);
  const [expandedRow, setExpandedRow]       = useState<number | null>(null);

  // ─── Shared staff fetch ───────────────────────────────────────────────────

  // Everyone on the books, active or not — an inactive member still has to be
  // listed to be edited or brought back. Only *deleted* staff drop off (they
  // stay in history). `activeStaff` below is the working roster the attendance,
  // payroll and record-entry screens use.
  const fetchStaff = useCallback(() => {
    setStaffLoading(true);
    api.get<StaffMember[]>("/staff")
      .then(setStaff)
      .catch((e: Error) => setError(e.message))
      .finally(() => setStaffLoading(false));
  }, []);

  useEffect(() => { fetchStaff(); }, [fetchStaff]);

  // ─── Attendance ───────────────────────────────────────────────────────────

  // Rebuild the table from server records. Used both when loading a day and
  // after saving one — the screen must never show a time the server didn't
  // store, or a failed save looks fine until the next refresh loses it.
  const applyRecords = useCallback((records: AttendanceRecord[]) => {
    const map: Record<number, { status: AttendanceStatus; check_in_time: string }> = {};
    // Default everyone to Absent — staff get marked Present as they check in.
    staff.filter((s) => s.is_active).forEach((s) => { map[s.id] = { status: "absent", check_in_time: "" }; });
    records.forEach((r) => { map[r.staff_id] = { status: r.status, check_in_time: r.check_in_time ? r.check_in_time.slice(0, 5) : "" }; });
    setAttendanceMap(map);
    setSavedStatus(Object.fromEntries(records.map((r) => [r.staff_id, r.status])));
  }, [staff]);

  // Late fines already charged on the shown day, so the Late Fine column knows
  // whether to offer Add or Remove. Narrowed to the one date (`from`/`to`) and
  // to late fines — a manual fine on the same day belongs to the Fines tab and
  // must not show up here as something this screen can take back off.
  // Returns its promise so `saveAttendance` can await it as its last step,
  // after writing the staged fines — the list on screen is then what the server
  // actually holds, not what the writes were expected to produce.
  const fetchDayFines = useCallback(() => {
    return api.get<FineRecord[]>(`/staff-fines?from=${attendanceDate}&to=${attendanceDate}&source=auto_late`)
      .then((rows) => setDayFines(normalizeFines(rows)))
      // Leave the last known list in place on failure. Clearing it would show
      // every charged row as uncharged — offering Add fine on someone already
      // fined, which is how you double-charge a salary over a dropped request.
      .catch(() => {});
  }, [attendanceDate]);

  const fetchAttendance = useCallback(() => {
    if (!staff.length) return;
    setAttendanceLoading(true);
    api.get<AttendanceRecord[]>(`/staff-attendance?date=${attendanceDate}`)
      .then((records) => {
        applyRecords(records);
        setAttendanceSaved(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setAttendanceLoading(false));
  }, [attendanceDate, staff, applyRecords]);

  useEffect(() => {
    if (activeTab !== "attendance") return;
    // Dropped here, not in `fetchDayFines`, which deliberately keeps its last
    // list on a failed refresh: switching day must not leave yesterday's fines
    // on screen, but a dropped refresh after a charge must not erase them.
    // Staged changes go too — they were about the day being left.
    setDayFines([]);
    setFineIntent({});
    fetchAttendance();
    fetchDayFines();
  }, [activeTab, attendanceDate, fetchAttendance, fetchDayFines]);

  const fetchHistory = useCallback((page: number) => {
    const PAGE_SIZE = 5;
    const today = new Date(todayStr() + "T00:00:00");
    const toDate = new Date(today);
    toDate.setDate(toDate.getDate() - (page * PAGE_SIZE + 1));
    const fromDate = new Date(toDate);
    fromDate.setDate(fromDate.getDate() - (PAGE_SIZE - 1));
    const from = ymd(fromDate);
    const to   = ymd(toDate);
    setHistoryLoading(true);
    api.get<AttendanceRecord[]>(`/staff-attendance?from=${from}&to=${to}`)
      .then((records) => {
        setHistoryRecords((prev) => page === 0 ? records : [...prev, ...records]);
        setHistoryPage(page);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setHistoryLoading(false));
  }, []);

  useEffect(() => {
    if (activeTab === "attendance") fetchHistory(0);
  }, [activeTab, fetchHistory]);

  useEffect(() => {
    if (activeTab !== "attendance") return;
    const id = setInterval(() => setClockTick(new Date()), 60_000);
    return () => clearInterval(id);
  }, [activeTab]);

  // ─── Leaves ───────────────────────────────────────────────────────────────

  const fetchLeaves = useCallback(() => {
    setLeavesLoading(true);
    api.get<LeaveRecord[]>(`/staff-leaves?month=${leavesMonth}`)
      .then(setLeaves)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLeavesLoading(false));
  }, [leavesMonth]);

  useEffect(() => {
    if (activeTab === "leaves") fetchLeaves();
  }, [activeTab, leavesMonth, fetchLeaves]);

  // ─── Advances ─────────────────────────────────────────────────────────────

  const fetchAdvances = useCallback(() => {
    setAdvancesLoading(true);
    api.get<AdvanceRecord[]>(`/staff-advances?month=${advancesMonth}`)
      .then(setAdvances)
      .catch((e: Error) => setError(e.message))
      .finally(() => setAdvancesLoading(false));
  }, [advancesMonth]);

  useEffect(() => {
    if (activeTab === "advances") fetchAdvances();
  }, [activeTab, advancesMonth, fetchAdvances]);

  // ─── Fines ────────────────────────────────────────────────────────────────

  // The rule (amount / grace / fallback shift start) lives in the backend
  // settings; fetch it once so the attendance preview and the Add Fine form
  // quote the same numbers the sync will actually charge.
  useEffect(() => {
    api.get<FineRule>("/staff-fines/rule").then(setFineRule).catch(() => {});
  }, []);

  const fetchFines = useCallback(() => {
    setFinesLoading(true);
    const params = new URLSearchParams({ month: finesMonth });
    if (finesStaffFilter) params.set("staff_id", finesStaffFilter);
    api.get<FineRecord[]>(`/staff-fines?${params}`)
      .then((rows) => setFines(normalizeFines(rows)))
      .catch((e: Error) => setError(e.message))
      .finally(() => setFinesLoading(false));
  }, [finesMonth, finesStaffFilter]);

  useEffect(() => {
    if (activeTab === "fines") fetchFines();
  }, [activeTab, fetchFines]);

  // ─── Food ─────────────────────────────────────────────────────────────────

  const fetchFoodLogs = useCallback(() => {
    setFoodLogsLoading(true);
    const params = new URLSearchParams();
    if (foodFilterStaff) params.set("staff_id", foodFilterStaff);
    params.set("month", foodReportMonth);
    api.get<{ data: FoodLogEntry[] }>(`/staff-food?${params}`)
      .then((res) => setFoodLogs(res.data ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setFoodLogsLoading(false));
  }, [foodFilterStaff, foodReportMonth]);

  const fetchFoodSummary = useCallback((month: string) => {
    setFoodSummaryLoading(true);
    api.get<MonthlySummary>(`/staff-food/summary?month=${month}`)
      .then(setFoodSummary)
      .catch((e: Error) => setError(e.message))
      .finally(() => setFoodSummaryLoading(false));
  }, []);

  useEffect(() => {
    if (activeTab === "food") fetchFoodLogs();
  }, [activeTab, fetchFoodLogs]);

  useEffect(() => {
    if (activeTab === "food") fetchFoodSummary(foodReportMonth);
  }, [activeTab, foodReportMonth, fetchFoodSummary]);

  // ─── Payroll ──────────────────────────────────────────────────────────────

  const fetchPayroll = useCallback(() => {
    setPayrollLoading(true);
    api.get<PayrollSummary>(`/staff-payroll?month=${payrollMonth}&working_days=${workingDays}`)
      .then(setPayroll)
      .catch((e: Error) => setError(e.message))
      .finally(() => setPayrollLoading(false));
  }, [payrollMonth, workingDays]);

  useEffect(() => {
    if (activeTab === "payroll") fetchPayroll();
  }, [activeTab, payrollMonth, workingDays, fetchPayroll]);

  // ─── Derived / memos ──────────────────────────────────────────────────────

  const activeStaff = staff.filter((s) => s.is_active);
  // The list carries inactive staff too, but the working roster comes first —
  // sort a copy, the feed's own name order is kept within each group.
  const filtered    = (roleFilter === "All" ? staff : staff.filter((s) => s.role === roleFilter))
    .slice()
    .sort((a, b) => Number(b.is_active) - Number(a.is_active));
  const totalSalary = activeStaff.reduce((a, s) => a + Number(s.salary), 0);

  const staffMap = useMemo(() => Object.fromEntries(staff.map((s) => [s.id, s])), [staff]);

  const historyByDate = useMemo(() => {
    const map: Record<string, AttendanceRecord[]> = {};
    historyRecords.forEach((r) => {
      if (!map[r.date]) map[r.date] = [];
      map[r.date].push(r);
    });
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [historyRecords]);

  const foodComputedTotal = useMemo(() => {
    const qty   = parseInt(foodForm.quantity)   || 0;
    const price = parseInt(foodForm.unit_price) || 0;
    return qty * price;
  }, [foodForm.quantity, foodForm.unit_price]);

  // ─── Staff tab handlers ───────────────────────────────────────────────────

  const openAddStaff = () => { setEditMember(null); setStaffForm({ ...emptyStaffForm }); setShowStaffForm(true); };
  const openEditStaff = (s: StaffMember) => {
    setEditMember(s);
    setStaffForm({ name: s.name, role: s.role, phone: s.phone ?? "", shift: THE_SHIFT, salary: String(s.salary), join_date: s.join_date ?? "", is_active: s.is_active });
    setShowStaffForm(true);
  };
  const handleSaveStaff = async () => {
    if (!staffForm.name) return;
    setStaffSaving(true);
    try {
      const payload = { ...staffForm, salary: Number(staffForm.salary) || 0 };
      if (editMember) await api.put(`/staff/${editMember.id}`, payload);
      else            await api.post("/staff", payload);
      setShowStaffForm(false);
      fetchStaff();
    } catch (e) { alert((e as Error).message); }
    finally { setStaffSaving(false); }
  };
  const handleDeleteStaff = async (id: number) => {
    try {
      await api.delete(`/staff/${id}`);
      setStaff((prev) => prev.filter((s) => s.id !== id));
      setDeleteStaffId(null);
    } catch (e) { alert((e as Error).message); }
  };

  // ─── Attendance handlers ──────────────────────────────────────────────────

  /**
   * Commit the whole sheet: the attendance times first, then the fine changes
   * staged against this day. **This is the only thing on the Attendance tab that
   * writes anything** — the Add fine / Remove links just mark rows.
   *
   * Returns whether everything landed.
   */
  const saveAttendance = async (): Promise<boolean> => {
    const active = staff.filter((s) => s.is_active);
    if (!active.length) return false;
    setAttendanceSaving(true);
    try {
      const records = active.map((s) => ({
        staff_id:      s.id,
        status:        attendanceMap[s.id]?.status         ?? "absent",
        check_in_time: attendanceMap[s.id]?.check_in_time || null,
      }));
      setError(null);
      // Saving records the day and charges nothing — fines are added one at a
      // time from the Late Fine column. The response echoes back the stored
      // rows: fold those into the table so the times on screen are the times in
      // the database, not the ones just typed. (Older APIs answer with the bare
      // records array; newer ones with `{ records, fines }`, where `fines` is
      // now always empty.)
      const res = await api.post<{ records: AttendanceRecord[]; fines: FineRecord[] } | AttendanceRecord[]>(
        "/staff-attendance/bulk", { date: attendanceDate, records },
      );
      const stored = Array.isArray(res) ? res : res?.records;
      if (stored) applyRecords(stored);

      // Then the fines that were queued against this day. Attendance goes first
      // on purpose: the API prices a fine off the *stored* check-in time and
      // refuses a day that has no attendance saved, so the times have to be down
      // before the charge is asked for.
      //
      // Only genuine differences are sent — clicking Add and then Remove on the
      // same row leaves the server exactly as it was and costs no request.
      const charged = new Set(dayFines.map((f) => Number(f.staff_id)));
      const changes = Object.entries(fineIntent)
        .map(([id, wanted]) => [Number(id), wanted] as const)
        .filter(([staffId, wanted]) => wanted !== charged.has(staffId));

      // One request each rather than one bulk call: the fine endpoints are keyed
      // by (staff, date) and idempotent, and a sheet is a dozen people at most.
      // A failure is reported per person and **keeps that row's pending change**,
      // so a retry is pressing Save again rather than re-clicking every link.
      const stuck: Record<number, boolean> = {};
      const failures: string[] = [];
      for (const [staffId, wanted] of changes) {
        try {
          if (wanted) {
            await api.post("/staff-fines/late", { staff_id: staffId, fine_date: attendanceDate });
          } else {
            await api.delete(`/staff-fines/late?staff_id=${staffId}&fine_date=${attendanceDate}`);
          }
        } catch (e) {
          stuck[staffId] = wanted;
          failures.push(`${staffMap[staffId]?.name ?? `#${staffId}`} — ${(e as Error).message}`);
        }
      }
      setFineIntent(stuck);

      if (failures.length) {
        setError(`Attendance saved, but these fines did not go through: ${failures.join("; ")}`);
      } else {
        setAttendanceSaved(attendanceDate);
      }

      // Re-read what is actually standing now, rather than trusting the writes.
      await fetchDayFines();

      return failures.length === 0;
    } catch (e) {
      // Loud and persistent: a save that failed must not leave the typed times
      // sitting there looking saved.
      setError(`Attendance for ${attendanceDate} was NOT saved — ${(e as Error).message}`);

      return false;
    }
    finally { setAttendanceSaving(false); }
  };

  const handleSaveAttendance = () => { void saveAttendance(); };

  // Typing a check-in time is the manager saying "this person turned up", so the
  // row stops being Absent. It no longer sorts them into Present vs Late by the
  // grace period — a late arrival *is* a present day, and the time itself says
  // when they got in. Half Day is left alone: that's a decision about the day,
  // not about the arrival. Clearing the box leaves the status as it was.
  const setCheckIn = (s: StaffMember, value: string) => {
    setAttendanceMap((prev) => {
      const entry = prev[s.id] ?? { status: "absent" as AttendanceStatus, check_in_time: "" };
      const status: AttendanceStatus =
        entry.status === "half_day" || !value ? entry.status : "present";

      return { ...prev, [s.id]: { status, check_in_time: value } };
    });
  };

  const shiftDate = (days: number) => {
    const d = new Date(attendanceDate + "T00:00:00");
    d.setDate(d.getDate() + days);
    setAttendanceDate(ymd(d));
  };

  // ─── Late-fine staging (the Add / Remove link on each attendance row) ─────

  // **Neither of these calls the API.** They mark what the row should end up as
  // and nothing more; `saveAttendance` is what writes the times and the fines,
  // in that order, when Save Attendance is pressed. So the sheet behaves like
  // one form: nothing on this screen is committed until it is saved, and a fine
  // clicked by mistake is undone by clicking the other link, not by a round trip
  // that has already taken money off someone.
  const queueLateFine = (s: StaffMember, wanted: boolean) => {
    setFineIntent((prev) => ({ ...prev, [s.id]: wanted }));
    setAttendanceSaved(null);   // there are unsaved changes again
  };

  // Marking someone Absent drops a *queued* fine with it — you cannot be late
  // for a day you never came in on, and the API refuses it anyway. A fine
  // already charged stays on screen so it can be taken off deliberately.
  const setStatus = (s: StaffMember, status: AttendanceStatus) => {
    setAttendanceMap((prev) => ({
      ...prev,
      [s.id]: { ...(prev[s.id] ?? { status: "absent" as AttendanceStatus, check_in_time: "" }), status },
    }));
    if (status === "absent") {
      setFineIntent((prev) => {
        if (prev[s.id] !== true) return prev;
        const next = { ...prev };
        delete next[s.id];

        return next;
      });
    }
  };

  // ─── Leave handlers ───────────────────────────────────────────────────────

  const handleSaveLeave = async () => {
    if (!leaveForm.staff_id || !leaveForm.start_date || !leaveForm.end_date) return;
    setLeaveSaving(true);
    try {
      await api.post("/staff-leaves", leaveForm);
      setShowLeaveForm(false);
      setLeaveForm({ ...emptyLeaveForm });
      fetchLeaves();
    } catch (e) { alert((e as Error).message); }
    finally { setLeaveSaving(false); }
  };

  const handleDeleteLeave = async (id: number) => {
    if (!confirm("Delete this leave record?")) return;
    try {
      await api.delete(`/staff-leaves/${id}`);
      setLeaves((prev) => prev.filter((l) => l.id !== id));
    } catch (e) { alert((e as Error).message); }
  };

  // ─── Advance handlers ─────────────────────────────────────────────────────

  const handleSaveAdvance = async () => {
    if (!advanceForm.staff_id || !advanceForm.amount) return;
    setAdvanceSaving(true);
    try {
      await api.post("/staff-advances", { ...advanceForm, amount: Number(advanceForm.amount) });
      setShowAdvanceForm(false);
      setAdvanceForm({ ...emptyAdvanceForm });
      fetchAdvances();
    } catch (e) { alert((e as Error).message); }
    finally { setAdvanceSaving(false); }
  };

  const handleDeleteAdvance = async (id: number) => {
    if (!confirm("Delete this advance record?")) return;
    try {
      await api.delete(`/staff-advances/${id}`);
      setAdvances((prev) => prev.filter((a) => a.id !== id));
    } catch (e) { alert((e as Error).message); }
  };

  // ─── Fine handlers ────────────────────────────────────────────────────────

  const openAddFine = () => {
    setEditFine(null);
    setFineForm(emptyFineForm(fineRule.amount));
    setFineFormError("");
    setShowFineForm(true);
  };

  const openEditFine = (f: FineRecord) => {
    setEditFine(f);
    setFineForm({
      staff_id: String(f.staff_id), amount: String(f.amount),
      fine_date: f.fine_date.slice(0, 10), reason: f.reason ?? "", notes: f.notes ?? "",
    });
    setFineFormError("");
    setShowFineForm(true);
  };

  const handleSaveFine = async () => {
    if (!fineForm.staff_id || !fineForm.amount || !fineForm.fine_date) {
      setFineFormError("Staff, amount and date are required."); return;
    }
    const amount = parseInt(fineForm.amount);
    if (isNaN(amount) || amount < 1) { setFineFormError("Amount must be a positive number."); return; }
    setFineSaving(true);
    setFineFormError("");
    try {
      const payload = {
        staff_id: parseInt(fineForm.staff_id), amount,
        fine_date: fineForm.fine_date,
        reason: fineForm.reason.trim() || null, notes: fineForm.notes.trim() || null,
      };
      if (editFine) await api.put(`/staff-fines/${editFine.id}`, payload);
      else          await api.post("/staff-fines", payload);
      setShowFineForm(false);
      fetchFines();
    } catch (e) { setFineFormError((e as Error).message || "Failed to save fine."); }
    finally { setFineSaving(false); }
  };

  const handleDeleteFine = async (id: number) => {
    try {
      await api.delete(`/staff-fines/${id}`);
      setFines((prev) => prev.filter((f) => f.id !== id));
      setFineDeleteId(null);
    } catch (e) { alert((e as Error).message); }
  };

  // ─── Food handlers ────────────────────────────────────────────────────────

  const openFoodAdd = () => { setFoodForm(emptyFoodForm()); setFoodFormError(""); setShowFoodModal(true); };

  const handleSaveFood = async () => {
    if (!foodForm.staff_id || !foodForm.item_name.trim() || !foodForm.quantity || !foodForm.unit_price || !foodForm.consumed_at) {
      setFoodFormError("Staff, item name, quantity, price and date are required."); return;
    }
    const qty   = parseInt(foodForm.quantity);
    const price = parseInt(foodForm.unit_price);
    if (isNaN(qty) || qty < 1)     { setFoodFormError("Quantity must be at least 1."); return; }
    if (isNaN(price) || price < 1) { setFoodFormError("Unit price must be a positive number."); return; }
    setFoodSaving(true);
    setFoodFormError("");
    try {
      const created = await api.post<FoodLogEntry>("/staff-food", {
        staff_id: parseInt(foodForm.staff_id), item_name: foodForm.item_name.trim(),
        quantity: qty, unit_price: price, consumed_at: foodForm.consumed_at,
        notes: foodForm.notes.trim() || null, added_by: foodForm.added_by.trim() || null,
      });
      setFoodLogs((prev) => [created, ...prev]);
      setShowFoodModal(false);
      fetchFoodSummary(foodReportMonth);
    } catch { setFoodFormError("Failed to save entry."); }
    finally { setFoodSaving(false); }
  };

  const handleDeleteFood = async (id: number) => {
    try {
      await api.delete(`/staff-food/${id}`);
      setFoodLogs((prev) => prev.filter((l) => l.id !== id));
      setFoodDeleteId(null);
      fetchFoodSummary(foodReportMonth);
    } catch (e) { alert((e as Error).message); }
  };

  const toggleFoodExpanded = (staffId: number) => {
    setExpandedFoodStaff((prev) => {
      const next = new Set(prev);
      next.has(staffId) ? next.delete(staffId) : next.add(staffId);
      return next;
    });
  };

  // ─── Payroll handlers ─────────────────────────────────────────────────────

  const printPayroll = () => {
    document.body.classList.add("print-payroll");
    window.print();
    document.body.classList.remove("print-payroll");
  };

  // =========================================================================
  // ─── Render: Staff Tab ───────────────────────────────────────────────────
  // =========================================================================

  function renderStaffTab() {
    return (
      <div className="p-6">
        <div className="grid grid-cols-4 gap-4 mb-5">
          {[
            { label: "Total Staff",     value: staff.length,       color: "text-blue-600",   bg: "bg-blue-50",   icon: "👥" },
            { label: "Active",          value: activeStaff.length, color: "text-green-600",  bg: "bg-green-50",  icon: "✅" },
            { label: "Inactive",        value: staff.filter(s => !s.is_active).length, color: "text-yellow-600", bg: "bg-yellow-50", icon: "🏖️" },
            { label: "Monthly Payroll", value: fmt(totalSalary),   color: "text-purple-600", bg: "bg-purple-50", icon: "💰" },
          ].map((c) => (
            <div key={c.label} className="bg-white rounded-xl border border-gray-100 shadow-soft p-5">
              <div className={`w-10 h-10 ${c.bg} rounded-xl flex items-center justify-center text-xl mb-3`}>{c.icon}</div>
              <div className={`text-2xl font-bold ${staffLoading ? "text-gray-200 animate-pulse" : c.color}`}>
                {staffLoading ? "——" : c.value}
              </div>
              <div className="text-sm text-gray-500 mt-0.5">{c.label}</div>
            </div>
          ))}
        </div>

        <div className="flex gap-2 mb-4 flex-wrap">
          {ROLES.map((r) => (
            <button key={r} onClick={() => setRoleFilter(r)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                roleFilter === r ? "bg-brand-red text-white" : "bg-white border border-gray-200 text-gray-600 hover:border-gray-400"
              }`}>
              {r} {r !== "All" && !staffLoading && `(${staff.filter((s) => s.role === r).length})`}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-soft overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-5 py-3 font-medium text-gray-500">Name</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Role</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Phone</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Shift</th>
                <th className="text-right px-5 py-3 font-medium text-gray-500">Salary</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Joined</th>
                <th className="text-center px-5 py-3 font-medium text-gray-500">Status</th>
                <th className="text-center px-5 py-3 font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {staffLoading
                ? Array.from({ length: 5 }).map((_, i) => <LoadingRow key={i} cols={8} />)
                : filtered.length === 0
                ? <tr><td colSpan={8} className="px-5 py-12 text-center text-gray-400">No staff found.</td></tr>
                : filtered.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3.5 font-medium text-gray-800">{s.name}</td>
                    <td className="px-5 py-3.5">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${ROLE_COLORS[s.role]}`}>{s.role}</span>
                    </td>
                    <td className="px-5 py-3.5 text-gray-600">{s.phone ?? "—"}</td>
                    <td className="px-5 py-3.5 text-gray-600">{s.shift ?? "—"}</td>
                    <td className="px-5 py-3.5 text-right font-semibold text-gray-800">{fmt(s.salary)}</td>
                    <td className="px-5 py-3.5 text-gray-500">{fmtDate(s.join_date)}</td>
                    <td className="px-5 py-3.5 text-center">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${s.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {s.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      {deleteStaffId === s.id ? (
                        <span className="inline-flex items-center gap-2">
                          {/* Deletion is permanent and takes their attendance,
                              leaves, advances and food logs with it — say so
                              here, not just in a tooltip nobody hovers. */}
                          <span className="text-xs text-red-600 font-medium">Delete permanently, with all records?</span>
                          <button onClick={() => handleDeleteStaff(s.id)} className="text-xs text-red-600 font-medium hover:underline">Yes</button>
                          <button onClick={() => setDeleteStaffId(null)} className="text-xs text-gray-500 hover:underline">No</button>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-3">
                          <button onClick={() => openEditStaff(s)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Edit</button>
                          <button
                            onClick={() => setDeleteStaffId(s.id)}
                            title="Deletes them for good, along with their attendance, leaves, advances and food logs. For someone who has just left, Edit and untick Active instead."
                            className="text-xs text-red-500 hover:text-red-700 font-medium">
                            Delete
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // =========================================================================
  // ─── Render: Attendance Tab ───────────────────────────────────────────────
  // =========================================================================

  function renderAttendanceTab() {
    const isToday = attendanceDate === todayStr();
    // Marking someone in with no time typed stamps the moment of marking, so
    // those rows name that time under the box (ticking each minute).
    const nowHHMM = `${String(clockTick.getHours()).padStart(2, "0")}:${String(clockTick.getMinutes()).padStart(2, "0")}`;
    // At most one late fine per person per day, so a plain lookup is enough.
    // `Number()` belt-and-braces on top of `normalizeFines`: this identity match
    // is the one that, when it fails, offers Add fine to someone already fined.
    const fineFor = (staffId: number) => dayFines.find((f) => Number(f.staff_id) === staffId);
    // Staged changes that would actually alter something: clicking Add and then
    // Remove on the same row cancels out and is not an unsaved change.
    const chargedIds = new Set(dayFines.map((f) => Number(f.staff_id)));
    const pendingFineCount = Object.entries(fineIntent)
      .filter(([staffId, wanted]) => wanted !== chargedIds.has(Number(staffId))).length;
    return (
      <div className="p-6">
        <div className="flex items-center gap-3 mb-5">
          <button onClick={() => shiftDate(-1)} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 text-sm">◀</button>
          <input type="date" value={attendanceDate} onChange={(e) => setAttendanceDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
          <button onClick={() => shiftDate(1)} disabled={isToday}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 text-sm disabled:opacity-40">▶</button>
        </div>

        {/* The one note on this tab: the save confirmation. There is no summary
            of what the day costs — each row already shows its own charge. */}
        {attendanceSaved === attendanceDate && (
          <div className="mb-4 px-4 py-3 rounded-xl border text-sm flex items-start gap-3 bg-green-50 border-green-200 text-green-700">
            <div className="flex-1">
              <span className="font-semibold">Attendance saved.</span>{" "}
              <span>
                Times and any fine changes on this sheet are written. Use{" "}
                <span className="font-medium">Add fine</span> in the Late Fine column to mark someone
                for a late-arrival fine, then save again.
              </span>
            </div>
            <button onClick={() => setAttendanceSaved(null)} className="text-xs underline shrink-0">Dismiss</button>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-100 shadow-soft overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-5 py-3 font-medium text-gray-500">#</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Name</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Role</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Status</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Check In Time</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Late Fine</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {attendanceLoading || staffLoading
                ? Array.from({ length: 6 }).map((_, i) => <LoadingRow key={i} cols={6} />)
                : activeStaff.length === 0
                ? <tr><td colSpan={6} className="px-5 py-12 text-center text-gray-400">No active staff found.</td></tr>
                : activeStaff.map((s, idx) => {
                  const entry = attendanceMap[s.id] ?? { status: "absent" as AttendanceStatus, check_in_time: "" };
                  // No time typed on today's sheet, and not already marked in?
                  // Saving stamps the current time — the time box says so.
                  const wasIn     = savedStatus[s.id] !== undefined && savedStatus[s.id] !== "absent";
                  const willStamp = !entry.check_in_time && entry.status !== "absent" && isToday && !wasIn;
                  // The Late Fine column does **not** work out or show how late
                  // anyone is. It is a charge, not a report: the check-in time is
                  // in the next column and the manager reads it themselves. (It
                  // used to preview "31 min late", in red past the grace period,
                  // which only answered a question the time already answers.)
                  //
                  // Anyone who turned up can be charged, late-looking or not —
                  // the manager decides. Only Absent has no late fine to speak
                  // of (and the backend refuses it too).
                  const canFine   = entry.status !== "absent";
                  // What the server has, what the manager has asked for, and
                  // what the row therefore ends up as once this is saved.
                  const onServer    = fineFor(s.id);
                  const wanted      = fineIntent[s.id];
                  const willCharge  = wanted ?? onServer !== undefined;
                  const pendingAdd  = wanted === true  && !onServer;
                  const pendingDrop = wanted === false && !!onServer;
                  return (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-5 py-3 text-gray-400 text-xs">{idx + 1}</td>
                      <td className="px-5 py-3 font-medium text-gray-800">{s.name}</td>
                      <td className="px-5 py-3">
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${ROLE_COLORS[s.role]}`}>{s.role}</span>
                      </td>
                      <td className="px-5 py-3">
                        <select
                          value={entry.status}
                          onChange={(e) => setStatus(s, e.target.value as AttendanceStatus)}
                          className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-red ${ATTENDANCE_COLORS[entry.status]}`}>
                          {(Object.keys(ATTENDANCE_LABELS) as AttendanceStatus[]).map((st) => (
                            <option key={st} value={st}>{ATTENDANCE_LABELS[st]}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-5 py-3">
                        <input type="time" value={entry.check_in_time}
                          onChange={(e) => setCheckIn(s, e.target.value)}
                          className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-red" />
                        {willStamp && (
                          <span className="block text-[11px] text-gray-400 mt-0.5">stamps {nowHHMM} on save</span>
                        )}
                      </td>
                      {/* Just the charge: the amount, and the one link that
                          changes it. The links only *stage* a fine — Save
                          Attendance is what charges or clears it. */}
                      <td className="px-5 py-3">
                        {!canFine && !onServer ? (
                          // Absent: nothing to charge a *late* fine for.
                          <span className="text-xs text-gray-300"
                            title="Mark them in to charge a late fine">—</span>
                        ) : (
                          <span className="inline-flex flex-col items-start gap-0.5">
                            {/* The money: what this row will cost once saved. A
                                fine on its way out is struck through rather than
                                vanishing, so the manager can see what Save does. */}
                            {willCharge ? (
                              <span className="text-xs font-semibold text-red-600">
                                {fmt(onServer?.amount ?? fineRule.amount)}
                              </span>
                            ) : pendingDrop ? (
                              <span className="text-xs font-semibold text-gray-400 line-through">
                                {fmt(onServer!.amount)}
                              </span>
                            ) : null}

                            {pendingAdd && <span className="text-[11px] text-amber-600">charges on save</span>}
                            {pendingDrop && <span className="text-[11px] text-amber-600">removed on save</span>}

                            {/* The action. Always offered for anyone marked in,
                                so the control is never invisible. */}
                            {willCharge ? (
                              <button onClick={() => queueLateFine(s, false)}
                                className="text-xs text-gray-500 hover:text-red-600 hover:underline font-medium">
                                Remove
                              </button>
                            ) : canFine ? (
                              <button onClick={() => queueLateFine(s, true)}
                                title={`Charge ${fmt(fineRule.amount)} to ${s.name} for ${fmtDate(attendanceDate)} when you save`}
                                className="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline">
                                + Add fine ({fmt(fineRule.amount)})
                              </button>
                            ) : null}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {/* Save sits *below* the table and to the right, where the roster is
            finished rather than where it starts: the counter works down the list
            and the button is the next thing under their hand at the bottom. */}
        <div className="flex items-center justify-end gap-3 mt-4">
          {pendingFineCount > 0 && (
            <span className="text-xs text-amber-600">
              {pendingFineCount} fine change{pendingFineCount !== 1 ? "s" : ""} not saved yet
            </span>
          )}
          <button onClick={handleSaveAttendance} disabled={attendanceSaving || attendanceLoading}
            className="px-5 py-2.5 text-sm font-medium bg-brand-red text-white rounded-lg hover:bg-brand-red-dark disabled:opacity-50">
            {attendanceSaving ? "Saving…" : "Save Attendance"}
          </button>
        </div>

        {/* Earlier days. No heading above them: each card is titled with its own
            date, which says what the list is without labelling it. */}
        <div className="mt-6">
          <div className="space-y-3">
            {historyByDate.map(([date, records]) => (
              <div key={date} className="bg-white rounded-xl border border-gray-100 shadow-soft overflow-hidden">
                <div className="px-5 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                  <span className="font-semibold text-gray-800 text-sm">{fmtDate(date)}</span>
                  <span className="text-xs text-gray-400">{records.length} record{records.length !== 1 ? "s" : ""}</span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-50">
                      <th className="text-left px-5 py-2 font-medium text-gray-400 text-xs">Name</th>
                      <th className="text-left px-5 py-2 font-medium text-gray-400 text-xs">Role</th>
                      <th className="text-left px-5 py-2 font-medium text-gray-400 text-xs">Status</th>
                      <th className="text-left px-5 py-2 font-medium text-gray-400 text-xs">Check In</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {records.map((r) => {
                      const member = staffMap[r.staff_id];
                      const name = r.staff?.name ?? member?.name ?? "—";
                      const role = (r.staff?.role ?? member?.role ?? "") as Role;
                      return (
                        <tr key={r.id ?? r.staff_id} className="hover:bg-gray-50">
                          <td className="px-5 py-2.5 font-medium text-gray-800">{name}</td>
                          <td className="px-5 py-2.5">
                            {role && <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[role] ?? "bg-gray-100 text-gray-600"}`}>{role}</span>}
                          </td>
                          <td className="px-5 py-2.5">
                            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${attendanceColor(r.status)}`}>{attendanceLabel(r.status)}</span>
                          </td>
                          <td className="px-5 py-2.5 text-gray-600 text-xs">{r.check_in_time ? r.check_in_time.slice(0, 5) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}

            {historyLoading && (
              <div className="bg-white rounded-xl border border-gray-100 shadow-soft overflow-hidden">
                <table className="w-full text-sm">
                  <tbody>{Array.from({ length: 5 }).map((_, i) => <LoadingRow key={i} cols={4} />)}</tbody>
                </table>
              </div>
            )}

            {!historyLoading && historyByDate.length === 0 && historyPage >= 0 && (
              <p className="text-sm text-gray-400">No previous attendance records found.</p>
            )}
          </div>

          {!historyLoading && historyPage >= 0 && (
            <div className="mt-4 text-center">
              <button
                onClick={() => fetchHistory(historyPage + 1)}
                className="px-5 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">
                Load More
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // =========================================================================
  // ─── Render: Leaves Tab ───────────────────────────────────────────────────
  // =========================================================================

  function renderLeavesTab() {
    const totalDays = leaves.reduce((a, l) => a + l.days_count, 0);
    return (
      <div className="p-6">
        <div className="flex items-center gap-3 mb-5">
          <label className="text-sm text-gray-600 font-medium">Month:</label>
          <input type="month" value={leavesMonth} onChange={(e) => setLeavesMonth(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
          <span className="text-sm text-gray-500">{leaves.length} record{leaves.length !== 1 ? "s" : ""} · {totalDays} days total</span>
          <button onClick={() => { setLeaveForm({ ...emptyLeaveForm }); setShowLeaveForm(true); }}
            className="ml-auto bg-brand-red text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-red-dark">
            + Add Leave
          </button>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-soft overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-5 py-3 font-medium text-gray-500">Staff</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Type</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">From</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">To</th>
                <th className="text-center px-5 py-3 font-medium text-gray-500">Days</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Reason</th>
                <th className="text-center px-5 py-3 font-medium text-gray-500">Delete</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {leavesLoading
                ? Array.from({ length: 4 }).map((_, i) => <LoadingRow key={i} cols={7} />)
                : leaves.length === 0
                ? <tr><td colSpan={7} className="px-5 py-12 text-center text-gray-400">No leave records for this month.</td></tr>
                : leaves.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3.5 font-medium text-gray-800">
                      {l.staff?.name ?? "—"}
                      <span className={`ml-2 text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[(l.staff?.role ?? "Helper") as Role]}`}>{l.staff?.role}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${LEAVE_COLORS[l.leave_type]}`}>{LEAVE_LABELS[l.leave_type]}</span>
                    </td>
                    <td className="px-5 py-3.5 text-gray-600">{fmtDate(l.start_date)}</td>
                    <td className="px-5 py-3.5 text-gray-600">{fmtDate(l.end_date)}</td>
                    <td className="px-5 py-3.5 text-center font-semibold text-gray-800">{l.days_count}</td>
                    <td className="px-5 py-3.5 text-gray-500 max-w-[200px] truncate">{l.reason ?? "—"}</td>
                    <td className="px-5 py-3.5 text-center">
                      <button onClick={() => handleDeleteLeave(l.id)} className="text-xs text-red-500 hover:text-red-700 font-medium">Delete</button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // =========================================================================
  // ─── Render: Advances Tab ─────────────────────────────────────────────────
  // =========================================================================

  function renderAdvancesTab() {
    const totalAdvances = advances.reduce((a, adv) => a + adv.amount, 0);
    return (
      <div className="p-6">
        <div className="flex items-center gap-3 mb-5">
          <label className="text-sm text-gray-600 font-medium">Repayment Month:</label>
          <input type="month" value={advancesMonth} onChange={(e) => setAdvancesMonth(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
          <span className="text-sm text-gray-500">{advances.length} advance{advances.length !== 1 ? "s" : ""} · {fmt(totalAdvances)}</span>
          <button onClick={() => { setAdvanceForm({ ...emptyAdvanceForm }); setShowAdvanceForm(true); }}
            className="ml-auto bg-brand-red text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-red-dark">
            + Add Advance
          </button>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-soft overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-5 py-3 font-medium text-gray-500">Staff</th>
                <th className="text-right px-5 py-3 font-medium text-gray-500">Amount</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Given Date</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Repayment</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Reason</th>
                <th className="text-center px-5 py-3 font-medium text-gray-500">Delete</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {advancesLoading
                ? Array.from({ length: 4 }).map((_, i) => <LoadingRow key={i} cols={6} />)
                : advances.length === 0
                ? <tr><td colSpan={6} className="px-5 py-12 text-center text-gray-400">No advance records for this month.</td></tr>
                : advances.map((adv) => (
                  <tr key={adv.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3.5 font-medium text-gray-800">
                      {adv.staff?.name ?? "—"}
                      <span className={`ml-2 text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[(adv.staff?.role ?? "Helper") as Role]}`}>{adv.staff?.role}</span>
                    </td>
                    <td className="px-5 py-3.5 text-right font-semibold text-red-600">{fmt(adv.amount)}</td>
                    <td className="px-5 py-3.5 text-gray-600">{fmtDate(adv.given_date)}</td>
                    <td className="px-5 py-3.5 text-gray-600">{adv.repayment_month}</td>
                    <td className="px-5 py-3.5 text-gray-500 max-w-[200px] truncate">{adv.reason ?? "—"}</td>
                    <td className="px-5 py-3.5 text-center">
                      <button onClick={() => handleDeleteAdvance(adv.id)} className="text-xs text-red-500 hover:text-red-700 font-medium">Delete</button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // =========================================================================
  // ─── Render: Fines Tab ────────────────────────────────────────────────────
  // =========================================================================

  function renderFinesTab() {
    const total     = fines.reduce((a, f) => a + f.amount, 0);
    const lateCount = fines.filter((f) => f.source === "auto_late").length;

    return (
      <div className="p-6">
        <div className="flex items-center gap-3 mb-5">
          <label className="text-sm text-gray-600 font-medium">Month:</label>
          <input type="month" value={finesMonth} onChange={(e) => setFinesMonth(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
          <label className="text-sm text-gray-600 font-medium ml-2">Staff:</label>
          <select value={finesStaffFilter} onChange={(e) => setFinesStaffFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red">
            <option value="">All Staff</option>
            {staff.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
          </select>
          <button onClick={openAddFine}
            className="ml-auto bg-brand-red text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-red-dark">
            + Add Fine
          </button>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-5">
          {[
            { label: "Total Fines",     value: fmt(total),                     color: "text-brand-red", bg: "bg-red-50",    icon: "⚠️" },
            { label: "Late Arrivals",   value: `${lateCount} late`,                 color: "text-orange-600", bg: "bg-orange-50", icon: "⏰" },
            { label: "Entered by Hand", value: `${fines.length - lateCount} manual`, color: "text-gray-700", bg: "bg-gray-50", icon: "✍️" },
          ].map((c) => (
            <div key={c.label} className="bg-white rounded-xl border border-gray-100 shadow-soft p-5">
              <div className={`w-10 h-10 ${c.bg} rounded-xl flex items-center justify-center text-xl mb-3`}>{c.icon}</div>
              <div className={`text-2xl font-bold ${finesLoading ? "text-gray-200 animate-pulse" : c.color}`}>
                {finesLoading ? "——" : c.value}
              </div>
              <div className="text-sm text-gray-500 mt-0.5">{c.label}</div>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-soft overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-5 py-3 font-medium text-gray-500">Staff</th>
                <th className="text-right px-5 py-3 font-medium text-gray-500">Amount</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Date</th>
                <th className="text-center px-5 py-3 font-medium text-gray-500">Type</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Reason</th>
                <th className="text-center px-5 py-3 font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {finesLoading
                ? Array.from({ length: 4 }).map((_, i) => <LoadingRow key={i} cols={6} />)
                : fines.length === 0
                ? <tr><td colSpan={6} className="px-5 py-12 text-center text-gray-400">No fines for this month.</td></tr>
                : fines.map((f) => {
                  const s = f.staff ?? staffMap[f.staff_id];
                  return (
                    <tr key={f.id} className="hover:bg-gray-50">
                      <td className="px-5 py-3.5 font-medium text-gray-800">
                        {s?.name ?? "—"}
                        {s?.role && (
                          <span className={`ml-2 text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[s.role as Role] ?? "bg-gray-100 text-gray-600"}`}>{s.role}</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right font-semibold text-red-600">{fmt(f.amount)}</td>
                      <td className="px-5 py-3.5 text-gray-600">{fmtDate(f.fine_date)}</td>
                      <td className="px-5 py-3.5 text-center">
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                          f.source === "auto_late" ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-gray-600"
                        }`}>
                          {f.source === "auto_late" ? "Late" : "Manual"}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-gray-500 max-w-[280px]">
                        <span className="block truncate">{f.reason ?? "—"}</span>
                        {f.notes && <span className="block text-xs text-gray-400 truncate">{f.notes}</span>}
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        {fineDeleteId === f.id ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="text-xs text-gray-500">Delete?</span>
                            <button onClick={() => handleDeleteFine(f.id)} className="text-xs text-red-600 font-medium hover:underline">Yes</button>
                            <button onClick={() => setFineDeleteId(null)} className="text-xs text-gray-500 hover:underline">No</button>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-3">
                            <button onClick={() => openEditFine(f)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Edit</button>
                            <button onClick={() => setFineDeleteId(f.id)} className="text-xs text-red-500 hover:text-red-700 font-medium">Delete</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
            {fines.length > 0 && !finesLoading && (
              <tfoot>
                <tr className="bg-gray-50 border-t-2 border-gray-200">
                  <td className="px-5 py-3 font-bold text-gray-800">Total ({fines.length})</td>
                  <td className="px-5 py-3 text-right font-bold text-brand-red">{fmt(total)}</td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <p className="text-xs text-gray-400 mt-3">
          <span className="font-medium text-orange-600">Late</span> fines are charged from the
          Attendance tab — the <span className="font-medium">Add fine</span> link beside a late
          check-in charges {fmt(fineRule.amount)} for that day, and Remove there takes it back off.
          Nothing is charged automatically. <span className="font-medium">Manual</span> fines
          (breakage, uniform) are added here. Every fine on this tab is deducted from that
          month&apos;s payroll.
        </p>
      </div>
    );
  }

  // =========================================================================
  // ─── Render: Food Tab ─────────────────────────────────────────────────────
  // =========================================================================

  function renderFoodTab() {
    // When a specific staff is selected, the summary reflects only that staff
    // (their food total, entry count, avg per entry) instead of all-staff totals.
    const selectedStaffId = foodFilterStaff ? Number(foodFilterStaff) : null;
    // The Actions (delete) column only exists for admins — see the entries table below.
    const foodLogCols = isAdmin ? 7 : 6;
    const summaryRows = foodSummary
      ? (selectedStaffId ? foodSummary.by_staff.filter((r) => r.staff_id === selectedStaffId) : foodSummary.by_staff)
      : [];
    const summaryTotal   = summaryRows.reduce((s, r) => s + r.total, 0);
    const summaryEntries = summaryRows.reduce((s, r) => s + r.entries.length, 0);
    const avgDenom       = selectedStaffId ? summaryEntries : summaryRows.length;

    return (
      <div className="p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600 font-medium">Month:</label>
          <input type="month" value={foodReportMonth} onChange={(e) => setFoodReportMonth(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
          <label className="text-sm text-gray-600 font-medium ml-3">Staff:</label>
          <select value={foodFilterStaff} onChange={(e) => setFoodFilterStaff(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red">
            <option value="">All Staff</option>
            {staff.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
          </select>
          <button onClick={openFoodAdd}
            className="ml-auto flex items-center gap-2 px-4 py-2 bg-brand-red text-white text-sm font-medium rounded-lg hover:opacity-90">
            + Add Food Entry
          </button>
        </div>

        {/* ── Entries ── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-soft overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Staff</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Item</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Qty</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Unit Price</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</th>
                {/* Only an admin may remove a food entry once it has been added. */}
                {isAdmin && <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {foodLogsLoading
                ? Array.from({ length: 5 }).map((_, i) => <LoadingRow key={i} cols={foodLogCols} />)
                : foodLogs.length === 0
                ? <tr><td colSpan={foodLogCols} className="px-4 py-12 text-center text-gray-400">No food entries for {foodReportMonth}.</td></tr>
                : foodLogs.map((log) => {
                  const s = log.staff ?? staffMap[log.staff_id];
                  return (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-700">{fmtDate(log.consumed_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{s?.name ?? "—"}</span>
                          {s?.role && (
                            <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${ROLE_COLORS[(s.role as Role)] ?? "bg-gray-100 text-gray-600"}`}>{s.role}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {log.item_name}
                        {log.notes && <span className="block text-xs text-gray-400">{log.notes}</span>}
                      </td>
                      <td className="px-4 py-3 text-center text-gray-700">{log.quantity}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{fmt(log.unit_price)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">{fmt(log.total_amount)}</td>
                      {isAdmin && (
                        <td className="px-4 py-3 text-right">
                          {foodDeleteId === log.id ? (
                            <span className="inline-flex items-center gap-2">
                              <span className="text-xs text-gray-500">Delete?</span>
                              <button onClick={() => handleDeleteFood(log.id)} className="text-xs text-red-600 font-medium hover:underline">Yes</button>
                              <button onClick={() => setFoodDeleteId(null)} className="text-xs text-gray-500 hover:underline">No</button>
                            </span>
                          ) : (
                            <button onClick={() => setFoodDeleteId(log.id)} className="text-xs text-red-500 font-medium hover:underline">Delete</button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {/* ── Monthly Summary ── */}
        {foodSummaryLoading ? (
          <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}</div>
        ) : summaryRows.length > 0 ? (
          <>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white rounded-xl border border-red-200/60 ring-1 ring-brand-red/10 shadow-soft p-5">
                <div className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">{selectedStaffId ? "Staff Food Total" : "Total Food Deductions"}</div>
                <div className="text-2xl font-bold text-brand-red">{fmt(summaryTotal)}</div>
                <div className="text-xs text-gray-400 mt-0.5">{foodReportMonth}</div>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 shadow-soft p-5">
                <div className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">{selectedStaffId ? "Total Entries" : "Staff with Entries"}</div>
                <div className="text-2xl font-bold text-gray-900">{selectedStaffId ? summaryEntries : summaryRows.length}</div>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 shadow-soft p-5">
                <div className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">{selectedStaffId ? "Avg per Entry" : "Avg per Staff"}</div>
                <div className="text-2xl font-bold text-gray-900">
                  {fmt(Math.round(summaryTotal / (avgDenom || 1)))}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {summaryRows.map((row) => (
                <div key={row.staff_id} className="bg-white rounded-xl border border-gray-100 shadow-soft overflow-hidden">
                  <button onClick={() => toggleFoodExpanded(row.staff_id)}
                    className="w-full flex items-center gap-4 px-5 py-4 hover:bg-gray-50 text-left">
                    <svg viewBox="0 0 20 20" fill="currentColor"
                      className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${expandedFoodStaff.has(row.staff_id) ? "rotate-90" : ""}`}>
                      <path fillRule="evenodd" d="M7.293 4.293a1 1 0 011.414 0l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414-1.414L11.586 10 7.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
                    </svg>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900">{row.staff_name}</span>
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${ROLE_COLORS[(row.role as Role)] ?? "bg-gray-100 text-gray-600"}`}>{row.role}</span>
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {row.entries.length} {row.entries.length === 1 ? "entry" : "entries"}
                        {isAdmin && ` · Salary: ${fmt(row.salary)}`}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold text-brand-red text-lg">{fmt(row.total)}</div>
                      {isAdmin && row.salary > 0 && <div className="text-xs text-gray-400">Net: {fmt(row.salary - row.total)}</div>}
                    </div>
                  </button>

                  {expandedFoodStaff.has(row.staff_id) && (
                    <div className="border-t border-gray-100">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50">
                            <th className="px-5 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Date</th>
                            <th className="px-5 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Item</th>
                            <th className="px-5 py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wide">Qty</th>
                            <th className="px-5 py-2 text-right text-xs font-semibold text-gray-400 uppercase tracking-wide">Unit</th>
                            <th className="px-5 py-2 text-right text-xs font-semibold text-gray-400 uppercase tracking-wide">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {row.entries.map((entry) => (
                            <tr key={entry.id} className="hover:bg-gray-50/50">
                              <td className="px-5 py-2.5 text-gray-600">{fmtDate(entry.consumed_at)}</td>
                              <td className="px-5 py-2.5 text-gray-700">
                                {entry.item_name}
                                {entry.notes && <span className="block text-xs text-gray-400">{entry.notes}</span>}
                              </td>
                              <td className="px-5 py-2.5 text-center text-gray-600">{entry.quantity}</td>
                              <td className="px-5 py-2.5 text-right text-gray-600">{fmt(entry.unit_price)}</td>
                              <td className="px-5 py-2.5 text-right font-medium text-gray-900">{fmt(entry.total_amount)}</td>
                            </tr>
                          ))}
                          <tr className="bg-red-50/50">
                            <td colSpan={4} className="px-5 py-2.5 text-right text-xs font-semibold text-gray-600 uppercase tracking-wide">Total Deduction</td>
                            <td className="px-5 py-2.5 text-right font-bold text-brand-red">{fmt(row.total)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    );
  }

  // =========================================================================
  // ─── Render: Payroll Tab ──────────────────────────────────────────────────
  // =========================================================================

  function renderPayrollTab() {
    // Final salary = earnings for present days, minus short leaves (½-day),
    // food and advance deductions. Absents are excluded by simply not being
    // paid (not double-penalised against the full salary).
    // Earnings come from the exact salary, not `daily_rate`: that is rounded for
    // display (10000/30 → 333), and 333 × 30 days pays 9990 for a full month.
    const earned = (r: PayrollRow) =>
      payroll && payroll.working_days > 0
        ? Math.round((r.base_salary * r.present_days) / payroll.working_days)
        : 0;
    const finalSalary = (r: PayrollRow) =>
      earned(r) - r.half_day_deduct - r.food_deduct - r.advance_deduct - r.fine_deduct;
    const totalFinal = payroll ? payroll.staff.reduce((sum, r) => sum + finalSalary(r), 0) : 0;

    return (
      <div className="p-6 print-area">
        <div className="flex items-center gap-3 mb-5 no-print">
          <label className="text-sm text-gray-600 font-medium">Month:</label>
          <input type="month" value={payrollMonth} onChange={(e) => setPayrollMonth(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
          <label className="text-sm text-gray-600 font-medium ml-3">Working Days:</label>
          <input type="number" value={workingDays} min={1} max={31}
            onChange={(e) => setWorkingDays(Number(e.target.value) || 30)}
            className="w-16 border border-gray-200 rounded-lg px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-brand-red" />
          <button onClick={fetchPayroll} disabled={payrollLoading}
            className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 disabled:opacity-50">
            {payrollLoading ? "Loading…" : "Recalculate"}
          </button>
          <button onClick={printPayroll}
            className="ml-auto px-4 py-2 text-sm font-medium bg-gray-800 text-white rounded-lg hover:bg-gray-900">
            🖨 Print Payroll
          </button>
        </div>

        {payroll && (
          <div className="grid grid-cols-3 gap-4 mb-5">
            {[
              { label: "Staff Count",       value: payroll.staff.length,           color: "text-blue-600",  bg: "bg-blue-50",  icon: "👥" },
              { label: "Total Base Salary", value: fmt(payroll.total_base_salary),  color: "text-gray-700",  bg: "bg-gray-50",  icon: "💼" },
              { label: "Total Final Salary", value: fmt(totalFinal),                 color: "text-green-600", bg: "bg-green-50", icon: "💵" },
            ].map((c) => (
              <div key={c.label} className="bg-white rounded-xl border border-gray-100 shadow-soft p-5">
                <div className={`w-10 h-10 ${c.bg} rounded-xl flex items-center justify-center text-xl mb-3`}>{c.icon}</div>
                <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
                <div className="text-sm text-gray-500 mt-0.5">{c.label}</div>
              </div>
            ))}
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-100 shadow-soft overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-800">Payroll — {payroll ? payroll.month : payrollMonth}</h3>
            {payroll && <span className="text-xs text-gray-400">{payroll.working_days} working days</span>}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-5 py-3 font-medium text-gray-500">Staff</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Status</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Present</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Absent</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">½ Day</th>
                <th className="text-right px-4 py-3 font-medium text-red-400">−Absent</th>
                <th className="text-right px-4 py-3 font-medium text-red-400">−Food</th>
                <th className="text-right px-4 py-3 font-medium text-red-400">−Advance</th>
                <th className="text-right px-4 py-3 font-medium text-red-400">−Fines</th>
                <th className="text-right px-5 py-3 font-medium text-green-700 bg-green-50">Final Salary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {payrollLoading
                ? Array.from({ length: 5 }).map((_, i) => <LoadingRow key={i} cols={10} />)
                : !payroll || payroll.staff.length === 0
                ? <tr><td colSpan={10} className="px-5 py-12 text-center text-gray-400">No data. Click Recalculate.</td></tr>
                : payroll.staff.map((row) => (
                  <>
                    <tr key={row.staff_id} className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => setExpandedRow(expandedRow === row.staff_id ? null : row.staff_id)}>
                      <td className="px-5 py-3.5">
                        <div className="font-medium text-gray-800">{row.staff_name}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[row.role as Role]}`}>{row.role}</span>
                          <span className="text-xs text-gray-400">{expandedRow === row.staff_id ? "▲" : "▼"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        {row.is_active === undefined
                          ? <span className="text-xs text-gray-300" title="This API build does not report staff status">—</span>
                          : <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${row.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                              {row.is_active ? "Active" : "Inactive"}
                            </span>}
                      </td>
                      <td className="px-4 py-3.5 text-center text-green-600 font-medium">{row.present_days}</td>
                      <td className="px-4 py-3.5 text-center text-red-500 font-medium">{row.absent_days}</td>
                      <td className="px-4 py-3.5 text-center text-yellow-600 font-medium">{row.half_days}</td>
                      <td className="px-4 py-3.5 text-right text-red-500">{row.absent_deduct + row.half_day_deduct > 0 ? `−${fmt(row.absent_deduct + row.half_day_deduct)}` : "—"}</td>
                      <td className="px-4 py-3.5 text-right text-red-500">{row.food_deduct > 0 ? `−${fmt(row.food_deduct)}` : "—"}</td>
                      <td className="px-4 py-3.5 text-right text-red-500">{row.advance_deduct > 0 ? `−${fmt(row.advance_deduct)}` : "—"}</td>
                      <td className="px-4 py-3.5 text-right text-red-500">{row.fine_deduct > 0 ? `−${fmt(row.fine_deduct)}` : "—"}</td>
                      <td className="px-5 py-3.5 text-right font-bold text-green-700 text-base bg-green-50">{fmt(finalSalary(row))}</td>
                    </tr>
                    {expandedRow === row.staff_id && (
                      <tr key={`${row.staff_id}-detail`} className="bg-gray-50">
                        <td colSpan={10} className="px-8 py-3">
                          <div className="grid grid-cols-4 gap-4 text-xs text-gray-600">
                            <div><span className="font-medium text-gray-700">Daily Rate:</span> {fmt(row.daily_rate)}</div>
                            <div><span className="font-medium text-gray-700">Present Days:</span> {row.present_days}</div>
                            <div><span className="font-medium text-gray-700">Earned (Present):</span> <span className="text-gray-800 font-semibold">{fmt(earned(row))}</span></div>
                            <div><span className="font-medium text-gray-700">Short Leave (½-day):</span> <span className="text-red-500">−{fmt(row.half_day_deduct)}</span></div>
                            <div><span className="font-medium text-gray-700">Food Deduct:</span> <span className="text-red-500">−{fmt(row.food_deduct)}</span></div>
                            <div><span className="font-medium text-gray-700">Advance Deduct:</span> <span className="text-red-500">−{fmt(row.advance_deduct)}</span></div>
                            <div><span className="font-medium text-gray-700">Fines:</span> <span className="text-red-500">−{fmt(row.fine_deduct)}</span></div>
                            <div className="col-span-2"><span className="font-medium text-gray-700">Final Salary:</span> <span className="text-green-700 font-bold">{fmt(finalSalary(row))}</span></div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
            </tbody>
            {payroll && payroll.staff.length > 0 && (
              <tfoot>
                <tr className="bg-gray-50 border-t-2 border-gray-200">
                  <td className="px-5 py-3 font-bold text-gray-800">Total ({payroll.staff.length} staff)</td>
                  <td colSpan={8} />
                  <td className="px-5 py-3 text-right font-bold text-green-700 text-base bg-green-50">{fmt(totalFinal)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    );
  }

  // =========================================================================
  // ─── Modals ───────────────────────────────────────────────────────────────
  // =========================================================================

  function renderStaffModal() {
    if (!showStaffForm) return null;
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">{editMember ? "Edit Employee" : "Add Employee"}</h2>
            <button onClick={() => setShowStaffForm(false)} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
              <input type="text" value={staffForm.name} onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })}
                placeholder="e.g. Bilal Ahmed"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select value={staffForm.role} onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value as Role })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red">
                  {(["Manager", "Chef", "Cashier", "Rider", "Waiter", "Helper"] as Role[]).map((r) => <option key={r}>{r}</option>)}
                </select>
              </div>
              {/* The restaurant runs one shift, so there is nothing to choose.
                  Shown rather than dropped so the form still says what shift
                  the person is on, and still submits it. */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Shift</label>
                <div className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-600">
                  {THE_SHIFT}
                  <span className="text-xs text-gray-400"> · the only shift</span>
                </div>
              </div>
            </div>
            {[
              { label: "Phone", key: "phone", type: "text", placeholder: "0300-1234567" },
              { label: "Salary (PKR)", key: "salary", type: "number", placeholder: "25000" },
              { label: "Join Date", key: "join_date", type: "date", placeholder: "" },
            ].map((f) => (
              <div key={f.key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{f.label}</label>
                <input type={f.type} value={(staffForm as Record<string, string | boolean>)[f.key] as string}
                  onChange={(e) => setStaffForm({ ...staffForm, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
              </div>
            ))}
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={staffForm.is_active} onChange={(e) => setStaffForm({ ...staffForm, is_active: e.target.checked })} className="w-4 h-4 accent-brand-red" />
              <span className="text-sm text-gray-700">Active employee</span>
            </label>
          </div>
          <div className="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end">
            <button onClick={() => setShowStaffForm(false)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
            <button onClick={handleSaveStaff} disabled={!staffForm.name || staffSaving}
              className="px-4 py-2 text-sm font-medium bg-brand-red text-white rounded-lg hover:bg-brand-red-dark disabled:opacity-50">
              {staffSaving ? "Saving…" : editMember ? "Save Changes" : "Add Employee"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderLeaveModal() {
    if (!showLeaveForm) return null;
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Add Leave Record</h2>
            <button onClick={() => setShowLeaveForm(false)} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Staff Member *</label>
              <select value={leaveForm.staff_id} onChange={(e) => setLeaveForm({ ...leaveForm, staff_id: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red">
                <option value="">— Select Staff —</option>
                {/* New records are filed against the working roster only. */}
                {activeStaff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Leave Type</label>
              <select value={leaveForm.leave_type} onChange={(e) => setLeaveForm({ ...leaveForm, leave_type: e.target.value as LeaveType })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red">
                {(Object.keys(LEAVE_LABELS) as LeaveType[]).map((t) => <option key={t} value={t}>{LEAVE_LABELS[t]}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">From *</label>
                <input type="date" value={leaveForm.start_date} onChange={(e) => setLeaveForm({ ...leaveForm, start_date: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">To *</label>
                <input type="date" value={leaveForm.end_date} onChange={(e) => setLeaveForm({ ...leaveForm, end_date: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
              <input type="text" value={leaveForm.reason} onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                placeholder="e.g. Sick, Personal, Eid"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
            </div>
          </div>
          <div className="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end">
            <button onClick={() => setShowLeaveForm(false)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
            <button onClick={handleSaveLeave} disabled={!leaveForm.staff_id || !leaveForm.start_date || !leaveForm.end_date || leaveSaving}
              className="px-4 py-2 text-sm font-medium bg-brand-red text-white rounded-lg hover:bg-brand-red-dark disabled:opacity-50">
              {leaveSaving ? "Saving…" : "Save Leave"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderAdvanceModal() {
    if (!showAdvanceForm) return null;
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Add Advance</h2>
            <button onClick={() => setShowAdvanceForm(false)} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Staff Member *</label>
              <select value={advanceForm.staff_id} onChange={(e) => setAdvanceForm({ ...advanceForm, staff_id: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red">
                <option value="">— Select Staff —</option>
                {activeStaff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount (PKR) *</label>
              <input type="number" value={advanceForm.amount} onChange={(e) => setAdvanceForm({ ...advanceForm, amount: e.target.value })}
                placeholder="e.g. 5000"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Given Date *</label>
                <input type="date" value={advanceForm.given_date} onChange={(e) => setAdvanceForm({ ...advanceForm, given_date: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Deduct in Month *</label>
                <input type="month" value={advanceForm.repayment_month} onChange={(e) => setAdvanceForm({ ...advanceForm, repayment_month: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
              <input type="text" value={advanceForm.reason} onChange={(e) => setAdvanceForm({ ...advanceForm, reason: e.target.value })}
                placeholder="e.g. Medical emergency"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
            </div>
          </div>
          <div className="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end">
            <button onClick={() => setShowAdvanceForm(false)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
            <button onClick={handleSaveAdvance} disabled={!advanceForm.staff_id || !advanceForm.amount || advanceSaving}
              className="px-4 py-2 text-sm font-medium bg-brand-red text-white rounded-lg hover:bg-brand-red-dark disabled:opacity-50">
              {advanceSaving ? "Saving…" : "Save Advance"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderFineModal() {
    if (!showFineForm) return null;
    const isAuto = editFine?.source === "auto_late";
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">{editFine ? "Edit Fine" : "Add Fine"}</h2>
            <button onClick={() => setShowFineForm(false)} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <div className="p-6 space-y-4">
            {fineFormError && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">{fineFormError}</div>
            )}
            {isAuto && (
              <div className="text-xs text-orange-700 bg-orange-50 border border-orange-200 px-3 py-2 rounded-lg">
                This is a late fine, charged from the Attendance tab. An edit here sticks — saving that
                day&apos;s attendance no longer rewrites it — but pressing <span className="font-medium">Add
                fine</span> on that day again re-prices it from the rule.
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Staff Member *</label>
              <select value={fineForm.staff_id} onChange={(e) => setFineForm({ ...fineForm, staff_id: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red">
                <option value="">— Select Staff —</option>
                {/* Editing keeps whoever it was filed against, even if they're off the roster now. */}
                {(editFine ? staff : activeStaff).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (PKR) *</label>
                <input type="number" min={1} value={fineForm.amount} onChange={(e) => setFineForm({ ...fineForm, amount: e.target.value })}
                  placeholder={String(fineRule.amount)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                <input type="date" value={fineForm.fine_date} onChange={(e) => setFineForm({ ...fineForm, fine_date: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
              <input type="text" value={fineForm.reason} onChange={(e) => setFineForm({ ...fineForm, reason: e.target.value })}
                placeholder="e.g. Late arrival, Breakage, Uniform"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <input type="text" value={fineForm.notes} onChange={(e) => setFineForm({ ...fineForm, notes: e.target.value })}
                placeholder="Optional note…"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
            </div>
            <p className="text-xs text-gray-400">Deducted from the payroll of {fineForm.fine_date.slice(0, 7) || "the fine's month"}.</p>
          </div>
          <div className="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end">
            <button onClick={() => setShowFineForm(false)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
            <button onClick={handleSaveFine} disabled={!fineForm.staff_id || !fineForm.amount || fineSaving}
              className="px-4 py-2 text-sm font-medium bg-brand-red text-white rounded-lg hover:bg-brand-red-dark disabled:opacity-50">
              {fineSaving ? "Saving…" : editFine ? "Save Changes" : "Add Fine"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderFoodModal() {
    if (!showFoodModal) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">Add Food Entry</h2>
            <button onClick={() => setShowFoodModal(false)} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <div className="px-6 py-5 space-y-4">
            {foodFormError && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">{foodFormError}</div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Staff Member *</label>
              <select value={foodForm.staff_id} onChange={(e) => setFoodForm((f) => ({ ...f, staff_id: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red">
                <option value="">Select staff...</option>
                {activeStaff.map((s) => <option key={s.id} value={String(s.id)}>{s.name} ({s.role})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Item Name *</label>
              <input type="text" value={foodForm.item_name} onChange={(e) => setFoodForm((f) => ({ ...f, item_name: e.target.value }))}
                placeholder="e.g. Chicken Burger, Fries..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Quantity *</label>
                <input type="number" min={1} value={foodForm.quantity} onChange={(e) => setFoodForm((f) => ({ ...f, quantity: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Unit Price (Rs) *</label>
                <input type="number" min={1} value={foodForm.unit_price} onChange={(e) => setFoodForm((f) => ({ ...f, unit_price: e.target.value }))}
                  placeholder="0"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
              </div>
            </div>
            {foodComputedTotal > 0 && (
              <div className="bg-red-50 rounded-lg px-3 py-2 flex items-center justify-between">
                <span className="text-sm text-gray-600">Total Amount</span>
                <span className="font-bold text-brand-red">{fmt(foodComputedTotal)}</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Date *</label>
                <input type="date" value={foodForm.consumed_at} onChange={(e) => setFoodForm((f) => ({ ...f, consumed_at: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Added By</label>
                <input type="text" value={foodForm.added_by} onChange={(e) => setFoodForm((f) => ({ ...f, added_by: e.target.value }))}
                  placeholder="Optional"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
              <input type="text" value={foodForm.notes} onChange={(e) => setFoodForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional note..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
            </div>
          </div>
          <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
            <button onClick={() => setShowFoodModal(false)} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800">Cancel</button>
            <button onClick={handleSaveFood} disabled={foodSaving}
              className="px-5 py-2 bg-brand-red text-white text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50">
              {foodSaving ? "Saving..." : "Add Entry"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // ─── Page Layout ──────────────────────────────────────────────────────────
  // =========================================================================

  const allTabs: { key: Tab; label: string; adminOnly?: boolean }[] = [
    { key: "staff",      label: "Staff",      adminOnly: true },
    { key: "attendance", label: "Attendance" },
    { key: "leaves",     label: "Leaves" },
    { key: "advances",   label: "Advances" },
    { key: "fines",      label: "Fines" },
    { key: "food",       label: "Food" },
    { key: "payroll",    label: "Payroll",    adminOnly: true },
  ];
  const tabs = allTabs.filter((t) => isAdmin || !t.adminOnly);

  const headerAction = activeTab === "staff"
    ? <button onClick={openAddStaff} className="flex items-center gap-2 bg-brand-red text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-red-dark">+ Add Employee</button>
    : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Staff</h1>
          <p className="text-sm text-gray-500">
            {staffLoading
              ? "Loading…"
              : `${activeStaff.length} active${isAdmin ? ` · Monthly payroll ${fmt(totalSalary)}` : ""}`}
          </p>
        </div>
        {headerAction}
      </div>

      {/* Tab bar */}
      <div className="bg-white border-b border-gray-200 px-6 flex gap-1 flex-shrink-0">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === t.key ? "border-brand-red text-brand-red" : "border-transparent text-gray-500 hover:text-gray-800"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 flex-shrink-0">
          {error} <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "staff"      && isAdmin && renderStaffTab()}
        {activeTab === "attendance" && renderAttendanceTab()}
        {activeTab === "leaves"     && renderLeavesTab()}
        {activeTab === "advances"   && renderAdvancesTab()}
        {activeTab === "fines"      && renderFinesTab()}
        {activeTab === "food"       && renderFoodTab()}
        {activeTab === "payroll"    && isAdmin && renderPayrollTab()}
      </div>

      {/* Modals */}
      {renderStaffModal()}
      {renderLeaveModal()}
      {renderAdvanceModal()}
      {renderFineModal()}
      {renderFoodModal()}
    </div>
  );
}
