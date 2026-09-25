import { PLAN_WEEKDAYS, TRAINING_PLAN_GENERATION_LIMITS } from "../../electron/trainingPlanGeneration";
import { OptionChips, OptionGroup } from "../components/OptionGroup";
import { FieldProblem, invalidProps, type StepProps } from "./GeneratorGoalStep";
import {
  DAY_KIND_LABEL,
  DAY_SHORT,
  HOURS_CHOICES,
  SESSION_CHOICES,
  cycleDay,
  dayTimeOptions,
  weekSummary
} from "./planGeneratorModel";

const LIMITS = TRAINING_PLAN_GENERATION_LIMITS;

/**
 * The athlete's usual week — day by day, or left to Coach with only what they
 * are sure of. "Not sure" is an answer everywhere, and "Coach picks" is a day
 * the plan may use or leave free.
 */
export function GeneratorWeekStep({ form, update, problemOf }: StepProps) {
  const summary = weekSummary(form);
  const setDay = (index: number, next: (typeof form.days)[number]) =>
    update({ days: form.days.map((day, at) => (at === index ? next : day)) }, "days");

  return (
    <div className="plan-generator-step">
      <div className="plan-generator-step-head">
        <div>
          <h3>Your usual week</h3>
          {/* Under the heading at its own width: beside it, the row put the
              switch at the far edge and wrapped it under the sentence. */}
          <div className="plan-generator-week-mode">
            <OptionGroup
              label="Who sets the week"
              size="sm"
              value={form.weekMode}
              options={[{ value: "days", label: "I'll set my days" }, { value: "coach", label: "Let Coach decide" }]}
              onChange={(weekMode) => update({ weekMode }, "days")}
            />
          </div>
          {form.weekMode === "days" ? (
            <>
              <p>Tap a day to cycle Rest, Train, Long day and Coach picks — a day Coach may use or leave empty.</p>
              <p>
                The time on each day is the most you have that day, not what Coach will schedule: a session may be
                shorter. Free means no limit.
              </p>
            </>
          ) : (
            <p>Coach sets your week from how you have trained recently. Tell it only what you are sure of.</p>
          )}
        </div>
      </div>

      {form.weekMode === "days" ? (
        <div id="plan-generator-days" className={`plan-generator-week${problemOf("days") ? " is-invalid" : ""}`}>
          {form.days.map((day, index) => (
            <div key={PLAN_WEEKDAYS[index]} className="plan-generator-day" data-kind={day.kind}>
              <button
                type="button"
                className="plan-generator-day-kind"
                aria-label={`${PLAN_WEEKDAYS[index]}: ${DAY_KIND_LABEL[day.kind]}. Change`}
                onClick={() => setDay(index, cycleDay(day))}
              >
                <span>{DAY_SHORT[index]}</span>
                <strong>{DAY_KIND_LABEL[day.kind]}</strong>
              </button>
              {/* The day's time is part of the day, inside its card. */}
              {day.kind === "rest" ? (
                <span className="plan-generator-day-time is-empty" aria-hidden="true">—</span>
              ) : (
                <OptionGroup
                  label={`Time on ${PLAN_WEEKDAYS[index]}`}
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
            <span id="plan-generator-hours-label">Time a week</span>
            <OptionGroup
              label="Time a week"
              size="sm"
              value={form.hoursChoice}
              options={HOURS_CHOICES.map((choice) => ({ value: choice.value, label: choice.label }))}
              onChange={(hoursChoice) => update({ hoursChoice }, "week")}
            />
          </div>
          <div className="plan-generator-field" role="group" aria-labelledby="plan-generator-sessions-label">
            <span id="plan-generator-sessions-label">Sessions a week</span>
            <OptionGroup
              label="Sessions a week"
              size="sm"
              value={form.sessionsChoice}
              options={SESSION_CHOICES.map((choice) => ({ value: choice, label: choice === "any" ? "Not sure" : choice }))}
              onChange={(sessionsChoice) => update({ sessionsChoice }, "week")}
            />
          </div>
          <div className="plan-generator-field" role="group" aria-labelledby="plan-generator-blocked-label">
            <span id="plan-generator-blocked-label">Days you can&rsquo;t train <small>optional</small></span>
            <OptionChips
              label="Days you can't train"
              size="sm"
              values={form.blockedDays.map(String)}
              options={DAY_SHORT.map((label, index) => ({ value: String(index), label, title: PLAN_WEEKDAYS[index] }))}
              onToggle={(value) => {
                const day = Number(value);
                update({ blockedDays: form.blockedDays.includes(day) ? form.blockedDays.filter((item) => item !== day) : [...form.blockedDays, day] }, "days");
              }}
            />
          </div>
          <p className="plan-generator-note">
            Nothing here is required. Coach picks the days, the long day and each session&rsquo;s length from how you have trained recently, and says what it chose in the plan&rsquo;s overview.
          </p>
        </div>
      )}
      <FieldProblem field="days" message={problemOf("days")} />
      <FieldProblem field="week" message={problemOf("week")} />

      <dl className="plan-generator-week-summary">
        <div><dt>Sessions a week</dt><dd>{summary.sessions}</dd></div>
        <div><dt>Time available</dt><dd>{summary.time}</dd></div>
        <div><dt>Long day</dt><dd>{summary.longDay}</dd></div>
      </dl>

      <label className="plan-generator-constraints">
        <span>Anything Coach should know? <small>optional</small></span>
        <textarea
          id="plan-generator-constraints"
          rows={3}
          value={form.constraints}
          maxLength={LIMITS.constraintsLength}
          placeholder="Injuries, equipment, travel, a week away…"
          onChange={(event) => update({ constraints: event.target.value }, "constraints")}
          {...invalidProps("constraints", problemOf("constraints"))}
        />
      </label>
      <FieldProblem field="constraints" message={problemOf("constraints")} />
    </div>
  );
}
