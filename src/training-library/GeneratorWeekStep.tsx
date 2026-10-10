import { TRAINING_PLAN_GENERATION_LIMITS } from "../../electron/trainingPlanGeneration";
import { OptionChips, OptionGroup } from "../components/OptionGroup";
import { FieldProblem, invalidProps, type StepProps } from "./GeneratorGoalStep";
import {
  DAY_KIND_LABEL,
  dayLongNames,
  dayShortNames,
  HOURS_CHOICES,
  SESSION_CHOICES,
  cycleDay,
  dayTimeOptions,
  weekSummary
} from "./planGeneratorModel";
import { t } from "../i18n/core";

const LIMITS = TRAINING_PLAN_GENERATION_LIMITS;

/**
 * The athlete's usual week — day by day, or left to Coach with only what they
 * are sure of. "Not sure" is an answer everywhere, and "Coach picks" is a day
 * the plan may use or leave free.
 */
export function GeneratorWeekStep({ form, update, problemOf }: StepProps) {
  const summary = weekSummary(form);
  const longNames = dayLongNames();
  const shortNames = dayShortNames();
  const setDay = (index: number, next: (typeof form.days)[number]) =>
    update({ days: form.days.map((day, at) => (at === index ? next : day)) }, "days");

  return (
    <div className="plan-generator-step">
      <div className="plan-generator-step-head">
        <div>
          <h3>{t("library.week.title")}</h3>
          {/* Under the heading at its own width: beside it, the row put the
              switch at the far edge and wrapped it under the sentence. */}
          <div className="plan-generator-week-mode">
            <OptionGroup
              label={t("library.week.who")}
              size="sm"
              value={form.weekMode}
              options={[{ value: "days", label: t("library.week.mine") }, { value: "coach", label: t("library.week.coach") }]}
              onChange={(weekMode) => update({ weekMode }, "days")}
            />
          </div>
          {form.weekMode === "days" ? (
            <>
              <p>{t("library.week.tap")}</p>
              <p>{t("library.week.ceiling")}</p>
            </>
          ) : (
            <p>{t("library.week.coachBody")}</p>
          )}
        </div>
      </div>

      {form.weekMode === "days" ? (
        <div id="plan-generator-days" className={`plan-generator-week${problemOf("days") ? " is-invalid" : ""}`}>
          {form.days.map((day, index) => (
            <div key={index} className="plan-generator-day" data-kind={day.kind}>
              <button
                type="button"
                className="plan-generator-day-kind"
                aria-label={t("library.week.dayChange", { day: longNames[index], kind: DAY_KIND_LABEL[day.kind] })}
                onClick={() => setDay(index, cycleDay(day))}
              >
                <span>{shortNames[index]}</span>
                <strong>{DAY_KIND_LABEL[day.kind]}</strong>
              </button>
              {/* The day's time is part of the day, inside its card. */}
              {day.kind === "rest" ? (
                <span className="plan-generator-day-time is-empty" aria-hidden="true">—</span>
              ) : (
                <OptionGroup
                  label={t("library.week.timeOn", { day: longNames[index] })}
                  mode="dropdown"
                  size="sm"
                  className="plan-generator-day-time"
                  value={day.minutes === null ? "free" : String(day.minutes)}
                  options={dayTimeOptions(day.minutes)}
                  onChange={(value) => setDay(index, { ...day, minutes: value === "free" ? null : Number(value) })}
                />
              )}
            </div>
          ))}
        </div>
      ) : (
        <div id="plan-generator-days" className="plan-generator-coach-week">
          <div className="plan-generator-field" role="group" aria-labelledby="plan-generator-hours-label">
            <span id="plan-generator-hours-label">{t("library.week.timeAWeek")}</span>
            <OptionGroup
              label={t("library.week.timeAWeek")}
              size="sm"
              value={form.hoursChoice}
              options={HOURS_CHOICES.map((choice) => ({ value: choice.value, label: choice.label }))}
              onChange={(hoursChoice) => update({ hoursChoice }, "week")}
            />
          </div>
          <div className="plan-generator-field" role="group" aria-labelledby="plan-generator-sessions-label">
            <span id="plan-generator-sessions-label">{t("library.week.sessionsAWeek")}</span>
            <OptionGroup
              label={t("library.week.sessionsAWeek")}
              size="sm"
              value={form.sessionsChoice}
              options={SESSION_CHOICES.map((choice) => ({ value: choice, label: choice === "any" ? t("library.notSure") : choice }))}
              onChange={(sessionsChoice) => update({ sessionsChoice }, "week")}
            />
          </div>
          <div className="plan-generator-field" role="group" aria-labelledby="plan-generator-blocked-label">
            <span id="plan-generator-blocked-label">{t("library.week.blocked")} <small>{t("library.week.optional")}</small></span>
            <OptionChips
              label={t("library.week.blocked")}
              size="sm"
              values={form.blockedDays.map(String)}
              options={shortNames.map((label, index) => ({ value: String(index), label, title: longNames[index] }))}
              onToggle={(value) => {
                const day = Number(value);
                update({ blockedDays: form.blockedDays.includes(day) ? form.blockedDays.filter((item) => item !== day) : [...form.blockedDays, day] }, "days");
              }}
            />
          </div>
          <p className="plan-generator-note">
            {t("library.week.nothingRequired")}
          </p>
        </div>
      )}
      <FieldProblem field="days" message={problemOf("days")} />
      <FieldProblem field="week" message={problemOf("week")} />

      <dl className="plan-generator-week-summary">
        <div><dt>{t("library.week.sessionsAWeek")}</dt><dd>{summary.sessions}</dd></div>
        <div><dt>{t("library.week.timeAvailable")}</dt><dd>{summary.time}</dd></div>
        <div><dt>{t("library.week.longDay")}</dt><dd>{summary.longDay}</dd></div>
      </dl>

      <label className="plan-generator-constraints">
        <span>{t("library.week.anything")} <small>{t("library.week.optional")}</small></span>
        <textarea
          id="plan-generator-constraints"
          rows={3}
          value={form.constraints}
          maxLength={LIMITS.constraintsLength}
          placeholder={t("library.week.anythingPh")}
          onChange={(event) => update({ constraints: event.target.value }, "constraints")}
          {...invalidProps("constraints", problemOf("constraints"))}
        />
      </label>
      <FieldProblem field="constraints" message={problemOf("constraints")} />
    </div>
  );
}
