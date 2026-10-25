#!/usr/bin/env python3
"""Analyse an exported `logs` table (CSV) per participant and per question.

Usage:
    python3 logs_analyze.py INPUT_CSV [--out DIR] [--questions ID [ID ...]]

The CSV needs the columns: user_id, action, details (JSON text), timestamp.

Privacy: email addresses are never read from the data or written to any output. Each user id is
mapped to an anonymous label (P01, P02, ... in order of user id) and only the label is written;
no file contains the user ids or any mapping back to them. Email-like text inside learners' chat
questions is replaced by "[email removed]".
"""
import argparse
import json
import re
import sys
from pathlib import Path

try:
    import pandas as pd
except ImportError:
    sys.exit("Error: this script needs pandas. Install it with: python3 -m pip install pandas")

REQUIRED_COLUMNS = ["user_id", "action", "details", "timestamp"]

# Actions the client may send (keep in sync with lib/log-actions.ts).
CLIENT_ACTIONS = {
    "start_button_click",
    "pause_button_click",
    "resume_button_click",
    "reset_button_click",
    "understand_button_click",
    "dont_understand_button_click",
    "blank_answer_submit",
    "ok_ai_output_button_click",
    "logout_button_click",
}
# Actions written by the server routes.
SERVER_ACTIONS = {
    "login_attempt",
    "login_failed",
    "login_success",
    "login_error",
    "logout",
    "logout_error",
    "questions_fetched",
    "questions_access_denied",
    "questions_fetch_error",
    "ai_generate_request",
    "ai_generate_success",
    "ai_generate_error",
    "ai_generate_stream_error",
    "ai_generate_access_denied",
    "ai_not_configured",
}
KNOWN_ACTIONS = CLIENT_ACTIONS | SERVER_ACTIONS

EMAIL_RE = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")


class AnalysisError(Exception):
    """A problem with the input that is reported as a clear message (no traceback)."""


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Per-participant, per-question analysis of an exported logs CSV (anonymised)."
    )
    parser.add_argument("input_csv", help="path to the exported logs CSV")
    parser.add_argument("--out", default="./analysis_out", help="output directory (default: ./analysis_out)")
    parser.add_argument(
        "--questions",
        nargs="+",
        type=int,
        metavar="ID",
        help="question ids to analyse (default: every question id found in the data)",
    )
    return parser.parse_args(argv)


def load_csv(path):
    p = Path(path)
    if not p.is_file():
        raise AnalysisError(f"input file not found: {path}")
    skipped_rows = []

    def on_bad_line(fields):
        skipped_rows.append(len(fields))
        return None  # skip the row

    try:
        df = pd.read_csv(p, dtype=str, engine="python", on_bad_lines=on_bad_line)
    except pd.errors.EmptyDataError:
        raise AnalysisError("input file is empty (no header row)")
    except UnicodeDecodeError:
        raise AnalysisError("input file is not valid UTF-8 text")
    except pd.errors.ParserError as exc:
        raise AnalysisError(f"could not parse the CSV: {type(exc).__name__}")

    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise AnalysisError(
            "missing required column(s): " + ", ".join(missing) + ". Columns found: " + ", ".join(map(str, df.columns))
        )
    if df.empty:
        raise AnalysisError("input file has a header but no data rows")
    return df, len(skipped_rows)


def parse_details(raw):
    """Return (dict, malformed). Empty details give ({}, False); invalid JSON or non-objects give ({}, True)."""
    if raw is None or (isinstance(raw, float) and pd.isna(raw)) or str(raw).strip() == "":
        return {}, False
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        return {}, True
    if not isinstance(value, dict):
        return {}, True
    return value, False


def as_question_id(value):
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and re.fullmatch(r"-?\d+", value.strip()):
        return int(value.strip())
    return None


def letters(i):
    """0 -> a, 1 -> b, ... 25 -> z, 26 -> aa (the original used chr(97 + i), which breaks after z)."""
    s = ""
    i += 1
    while i:
        i, rem = divmod(i - 1, 26)
        s = chr(97 + rem) + s
    return s


def prepare(df):
    df = df.reset_index(drop=True).copy()
    df["_row"] = range(len(df))

    parsed = df["details"].apply(parse_details)
    df["_details"] = parsed.apply(lambda t: t[0])
    malformed_details = int(parsed.apply(lambda t: t[1]).sum())

    df["questionId"] = df["_details"].apply(lambda d: as_question_id(d.get("questionId")))
    df["isCorrect"] = df["_details"].apply(lambda d: d.get("isCorrect"))
    df["question_asked"] = df.apply(
        lambda r: r["_details"].get("userQuestion") if r["action"] == "ai_generate_request" else None, axis=1
    )

    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce", utc=True)
    bad_timestamps = int(df["timestamp"].isna().sum())
    df = df[df["timestamp"].notna()]

    missing_user = int(df["user_id"].isna().sum())
    df = df[df["user_id"].notna()]
    return df, malformed_details, bad_timestamps, missing_user


def make_labels(user_ids):
    def key(u):
        return (0, int(u), u) if re.fullmatch(r"\d+", u.strip()) else (1, 0, u)

    ordered = sorted(set(user_ids), key=key)
    width = max(2, len(str(len(ordered))))
    return {u: f"P{i + 1:0{width}d}" for i, u in enumerate(ordered)}


def redact(text):
    return EMAIL_RE.sub("[email removed]", str(text))


def analyse_user(user_df, question_ids):
    """Same metric definitions as the original script (see the notes in the report)."""
    # Rows sorted by time; equal timestamps keep their CSV order.
    ordered = user_df.sort_values(by=["timestamp", "_row"], kind="stable").reset_index(drop=True)

    blank = ordered["action"] == "blank_answer_submit"
    correct = int((blank & (ordered["isCorrect"] == True)).sum())  # noqa: E712
    incorrect = int((blank & (ordered["isCorrect"] == False)).sum())  # noqa: E712

    do_not_understand = int((ordered["action"] == "dont_understand_button_click").sum())

    # Chat questions, in the original CSV row order of this user's rows.
    asked_rows = user_df.sort_values("_row")
    questions_asked = [
        redact(q) for q in asked_rows.loc[asked_rows["action"] == "ai_generate_request", "question_asked"].dropna().tolist()
    ]

    time_spent = {}
    for qid in question_ids:
        q_rows = ordered[ordered["questionId"] == qid]
        if q_rows.empty:
            time_spent[qid] = 0
        else:
            time_spent[qid] = (q_rows["timestamp"].iloc[-1] - q_rows["timestamp"].iloc[0]).total_seconds() / 60

    # For each blank_answer_submit (not the user's very first row): seconds since the previous row.
    answer_times = {qid: [] for qid in question_ids}
    for i in range(1, len(ordered)):
        qid = ordered["questionId"].iloc[i]
        if ordered["action"].iloc[i] == "blank_answer_submit" and pd.notnull(qid) and int(qid) in answer_times:
            answer_times[int(qid)].append((ordered["timestamp"].iloc[i] - ordered["timestamp"].iloc[i - 1]).total_seconds())

    return {
        "total_questions_asked_to_user": correct + incorrect,
        "correct_answers": correct,
        "incorrect_answers": incorrect,
        "i_do_not_understand": do_not_understand,
        "user_questions_asked": questions_asked,
        "time_spent": time_spent,
        "answer_times": answer_times,
    }


def run(args):
    df, skipped_csv_rows = load_csv(args.input_csv)
    rows_read = len(df)
    df, malformed_details, bad_timestamps, missing_user = prepare(df)
    if df.empty:
        raise AnalysisError("no usable rows: every row has a missing user_id or an unreadable timestamp")

    labels = make_labels(df["user_id"].tolist())

    if args.questions:
        question_ids = sorted(set(args.questions))
    else:
        question_ids = sorted({int(q) for q in df["questionId"].dropna()})
    if not question_ids:
        raise AnalysisError("no question ids found in the data (no row has details.questionId); pass --questions to set them")

    action_counts = df["action"].fillna("(missing)").value_counts()
    unknown = {a: int(n) for a, n in action_counts.items() if a not in KNOWN_ACTIONS}

    results = {}
    for user_id, user_df in df.groupby("user_id"):
        results[labels[user_id]] = analyse_user(user_df, question_ids)

    max_times = {q: max((len(r["answer_times"][q]) for r in results.values()), default=0) for q in question_ids}

    participant_rows = []
    question_rows = []
    for label in sorted(results):
        r = results[label]
        row = {
            "participant": label,
            "total_questions_asked_to_user": r["total_questions_asked_to_user"],
            "correct_answers": r["correct_answers"],
            "incorrect_answers": r["incorrect_answers"],
            "i_do_not_understand": r["i_do_not_understand"],
            "user_questions_asked": r["user_questions_asked"],
        }
        for q in question_ids:
            row[f"time_spent_question_{q}(mins)"] = r["time_spent"][q]
        for q in question_ids:
            for i in range(max_times[q]):
                times = r["answer_times"][q]
                row[f"Q{q}{letters(i)}(secs)"] = times[i] if i < len(times) else None
        participant_rows.append(row)
        for q in question_ids:
            question_rows.append(
                {
                    "participant": label,
                    "question_id": q,
                    "time_spent_mins": r["time_spent"][q],
                    "blank_answers_timed": len(r["answer_times"][q]),
                    "answer_times_secs": ";".join(f"{t:.3f}" for t in r["answer_times"][q]),
                }
            )

    out_dir = Path(args.out)
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
        pd.DataFrame(participant_rows).to_csv(out_dir / "participants.csv", index=False)
        pd.DataFrame(question_rows).to_csv(out_dir / "per_question.csv", index=False)
        pd.DataFrame(
            [{"action": a, "count": int(n), "recognised": a in KNOWN_ACTIONS} for a, n in action_counts.items()]
        ).to_csv(out_dir / "action_counts.csv", index=False)
    except OSError as exc:
        raise AnalysisError(f"could not write output to {args.out}: {type(exc).__name__}")

    print(f"Rows read: {rows_read} | participants: {len(results)} | question ids: {', '.join(map(str, question_ids))}")
    print(
        f"Skipped: {skipped_csv_rows} malformed CSV row(s), {bad_timestamps} row(s) with an unreadable timestamp, "
        f"{missing_user} row(s) without a user_id. Rows with malformed or non-object details (treated as empty): {malformed_details}."
    )
    if unknown:
        print("Unrecognised actions (counted, otherwise ignored): " + ", ".join(f"{a}={n}" for a, n in sorted(unknown.items())))
    else:
        print("Unrecognised actions: none")
    print("participant  correct  incorrect  dont_understand  " + "  ".join(f"min_Q{q}" for q in question_ids))
    for row in participant_rows:
        mins = "  ".join(f"{row[f'time_spent_question_{q}(mins)']:>6.2f}" for q in question_ids)
        print(
            f"{row['participant']:<11}  {row['correct_answers']:>7}  {row['incorrect_answers']:>9}  "
            f"{row['i_do_not_understand']:>15}  {mins}"
        )
    print(f"Wrote participants.csv, per_question.csv and action_counts.csv to {out_dir}")


def main(argv=None):
    args = parse_args(argv)
    try:
        run(args)
    except AnalysisError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # last resort: a clear message instead of a traceback
        print(f"Unexpected error ({type(exc).__name__}). Check that the input is an export of the logs table.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
