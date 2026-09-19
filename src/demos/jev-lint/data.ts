// Six sample files. Planted issues are annotated inline with `⟦kind|note⟧`, or
// `⟦kind@probe|note⟧` when a shipped probe claims the issue, and stripped at load time so the
// editor (and the model) never sees the annotations. An issue with no `@probe` is out of scope:
// it is listed in the reveal panel, greyed, and counts neither for nor against the demo.

import type { Language } from "./analysis.ts";
import type { Planted } from "./eval.ts";
import type { Kind } from "./markers.ts";

export interface Sample {
  id: string;
  label: string;
  filename: string;
  language: Language;
  text: string;
  planted: Planted[];
  /**
   * Function typed by "Type it for me", appended to the end of the file. Its defect is a
   * string-built query, command or path — the one kind the shipped probe separates — so the
   * flagship interaction actually draws a squiggle.
   */
  demo: string;
  /** Second typed function, planting `demoAltKind`. Nothing lights up; that is the point. */
  demoAlt: string;
  demoAltKind: Kind;
}

const MARK = /\s*⟦([a-z_]+)(?:@([a-z_]+))?\|([^⟧]*)⟧/g;

export function parseAnnotated(annotated: string): { text: string; planted: Planted[] } {
  const planted: Planted[] = [];
  const lines = annotated.replace(/^\n/, "").split("\n");
  const clean = lines.map((line, i) => {
    for (const m of line.matchAll(MARK)) planted.push({ line: i + 1, kind: m[1] as Kind, note: m[3], probe: m[2] });
    return line.replace(MARK, "");
  });
  return { text: clean.join("\n"), planted };
}

function sample(id: string, label: string, filename: string, language: Language, annotated: string, demo: string, demoAlt: string, demoAltKind: Kind): Sample {
  return { id, label, filename, language, ...parseAnnotated(annotated), demo: demo.replace(/^\n/, ""), demoAlt: demoAlt.replace(/^\n/, ""), demoAltKind };
}

export const SAMPLES: Sample[] = [
  sample(
    "ts",
    "TypeScript",
    "orders.ts",
    "typescript",
    `
import { createHash } from "node:crypto";
import type { Db } from "./db";

export interface Order {
  id: string;
  userId: string;
  items: { sku: string; qty: number; priceCents: number }[];
  couponCode?: string;
}

export function orderTotal(order: Order): number {
  let total = 0;
  for (const item of order.items) total += item.qty * item.priceCents;
  return total;
}

export function lastItem<T>(items: T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[items.length]; ⟦probable_bug|off-by-one: length instead of length - 1⟧
}

export async function loadUsersForOrders(db: Db, orders: Order[]) {
  const users = new Map<string, unknown>();
  for (const order of orders) {
    const user = await db.query("SELECT * FROM users WHERE id = '" + order.userId + "'"); ⟦security_risk@injection|SQL injection via string concatenation⟧
    users.set(order.userId, user);
  }
  return users;
}

export function applyCoupon(total: number, code: string | undefined): number {
  const hasCoupon = code === undefined; ⟦misleading_name|hasCoupon is true when there is no coupon⟧
  if (hasCoupon) return total;
  if (code === "HALF") return Math.round(total / 2);
  return total;
}

export function signOrder(order: Order): string {
  const secret = "sk_live_9f8a7b6c5d4e3f2a1b0c"; ⟦security_risk|hardcoded live secret⟧
  return createHash("sha256").update(order.id + secret).digest("hex");
}

export function findDuplicateSkus(orders: Order[]): string[] {
  const seen: string[] = [];
  const dupes: string[] = [];
  for (const order of orders) {
    for (const item of order.items) {
      if (seen.includes(item.sku)) dupes.push(item.sku); ⟦performance_smell|linear includes inside nested loop (quadratic)⟧
      seen.push(item.sku);
    }
  }
  return dupes;
}

export function describeOrder(order: Order): string {
  const total = orderTotal(order);
  return \`Order \${order.id}: \${order.items.length} items, \${(total / 100).toFixed(2)}\`;
  console.log("described", order.id); ⟦dead_or_unreachable|statement after return⟧
}

export function isEligibleForFreeShipping(order: Order): boolean {
  const total = orderTotal(order);
  if (total = 5000) return true; ⟦probable_bug|assignment in condition⟧
  return order.items.length > 10;
}

export function skuCount(order: Order): number {
  return new Set(order.items.map((i) => i.sku)).size;
}
`,
    `

export function findByEmail(db: Db, email: string) {
  const sql = "SELECT * FROM users WHERE email = '" + email + "'";
  return db.query(sql);
}
`,
    `

export function averagePrice(order: Order): number {
  let sum = 0;
  for (let i = 0; i <= order.items.length; i++) {
    sum += order.items[i].priceCents;
  }
  const isEmpty = order.items.length > 0;
  if (isEmpty) return 0;
  return sum / order.items.length;
}
`,
    "probable_bug",
  ),
  sample(
    "py",
    "Python",
    "reports.py",
    "python",
    `
import os
import random
import sqlite3
from pathlib import Path


def connect(path: str) -> sqlite3.Connection:
    return sqlite3.connect(path)


def fetch_user(conn: sqlite3.Connection, user_id: str) -> dict | None:
    row = conn.execute(f"SELECT id, name FROM users WHERE id = '{user_id}'").fetchone() ⟦security_risk@injection|SQL injection via f-string⟧
    if row is None:
        return None
    return {"id": row[0], "name": row[1]}


def average(values: list[float]) -> float:
    total = sum(values)
    return total / len(values) ⟦probable_bug|ZeroDivisionError on empty list⟧


def read_report(base_dir: str, name: str) -> str:
    path = os.path.join(base_dir, name) ⟦security_risk|path traversal: user-controlled name joined without normalisation⟧
    with open(path) as f:
        return f.read()


def make_reset_token() -> str:
    return "".join(random.choice("abcdef0123456789") for _ in range(32)) ⟦security_risk|random module used for a security token⟧


def user_names(conn: sqlite3.Connection, user_ids: list[str]) -> list[str]:
    names = []
    for user_id in user_ids:
        row = conn.execute("SELECT name FROM users WHERE id = ?", (user_id,)).fetchone() ⟦performance_smell|N+1 query inside loop⟧
        if row:
            names.append(row[0])
    return names


def is_valid_email(address: str) -> bool:
    is_invalid = "@" in address and "." in address ⟦misleading_name|is_invalid holds the validity result⟧
    return is_invalid


def cleanup(tmp: Path) -> int:
    removed = 0
    for child in tmp.iterdir():
        try:
            child.unlink()
            removed += 1
        except Exception: ⟦probable_bug|exception swallowed silently⟧
            pass
    return removed


def percent(part: int, whole: int) -> int:
    if whole == 0:
        return 0
    return int(part / whole * 100)


def first_word(text: str) -> str:
    parts = text.split()
    return parts[0] if parts else ""
`,
    `


def delete_report(base_dir: str, name: str) -> None:
    os.system("rm -rf " + base_dir + "/" + name)
    print("removed", name)
`,
    `


def median(values: list[float]) -> float:
    ordered = sorted(values)
    mid = len(ordered) / 2
    if len(ordered) % 2 == 0:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2
`,
    "probable_bug",
  ),
  sample(
    "go",
    "Go",
    "server.go",
    "go",
    `
package main

import (
	"crypto/md5"
	"database/sql"
	"fmt"
	"math/rand"
	"net/http"
	"os/exec"
)

type Server struct {
	db *sql.DB
}

func (s *Server) getUser(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	row := s.db.QueryRow("SELECT name FROM users WHERE id = " + id) ⟦security_risk@injection|SQL injection via concatenation⟧
	var name string
	if err := row.Scan(&name); err != nil {
		http.Error(w, "not found", 404)
		return
	}
	fmt.Fprint(w, name)
}

func sessionToken() string {
	return fmt.Sprintf("%x", rand.Int63()) ⟦security_risk|math/rand for a session token⟧
}

func hashPassword(pw string) string {
	sum := md5.Sum([]byte(pw)) ⟦security_risk|MD5 for password hashing⟧
	return fmt.Sprintf("%x", sum)
}

func (s *Server) ping(w http.ResponseWriter, r *http.Request) {
	host := r.URL.Query().Get("host")
	out, err := exec.Command("sh", "-c", "ping -c 1 "+host).Output() ⟦security_risk@injection|shell injection via user-controlled host⟧
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	w.Write(out)
}

func sumInts(xs []int) int {
	total := 0
	for i := 0; i <= len(xs); i++ { ⟦probable_bug|off-by-one: <= len(xs) panics⟧
		total += xs[i]
	}
	return total
}

func (s *Server) countRows() (int, error) {
	var n int
	err := s.db.QueryRow("SELECT COUNT(*) FROM users").Scan(&n)
	if err == nil { ⟦probable_bug|inverted error check: returns on success⟧
		return 0, err
	}
	return n, nil
}

func contains(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}

func (s *Server) close() error {
	return s.db.Close()
	fmt.Println("closed") ⟦dead_or_unreachable|statement after return⟧
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
`,
    `

func (s *Server) userAges(ids []string) ([]int, error) {
	ages := make([]int, 0)
	for _, id := range ids {
		row := s.db.QueryRow("SELECT age FROM users WHERE id = '" + id + "'")
		var age int
		if err := row.Scan(&age); err == nil {
			return nil, err
		}
		ages = append(ages, age)
	}
	return ages, nil
}
`,
    `

func maxAge(ages []int) int {
	best := ages[0]
	for i := 0; i <= len(ages); i++ {
		if ages[i] > best {
			best = ages[i]
		}
	}
	return best
}
`,
    "probable_bug",
  ),
  sample(
    "sql",
    "SQL",
    "reporting.sql",
    "sql",
    `
-- Monthly reporting queries for the orders warehouse.

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_user_id_idx ON orders (user_id);

-- Revenue per user for the current month.
SELECT u.id, u.email, SUM(o.total_cents) AS revenue_cents
FROM users u
JOIN orders o ON o.user_id = u.id
WHERE o.created_at >= date_trunc('month', now())
  AND o.status = 'paid'
GROUP BY u.id, u.email
ORDER BY revenue_cents DESC;

-- Users who have never ordered.
SELECT u.id, u.email
FROM users u
WHERE u.id NOT IN (SELECT o.user_id FROM orders o); ⟦probable_bug|NOT IN with nullable user_id returns no rows when any NULL present⟧

-- Orders with their user, one lookup per row.
SELECT o.id,
       (SELECT email FROM users WHERE users.id = o.user_id) AS email ⟦performance_smell|correlated subquery per row instead of a join⟧
FROM orders o
WHERE o.status = 'paid';

-- Refund every unpaid order older than 30 days.
UPDATE orders SET status = 'refunded'
WHERE status = 'unpaid' OR created_at < now() - interval '30 days'; ⟦probable_bug|OR instead of AND refunds every unpaid order and every old order⟧

-- Average order value.
SELECT AVG(total_cents) AS avg_cents FROM orders WHERE status = 'paid';

-- Active users: anyone with an order in the last year.
CREATE OR REPLACE VIEW inactive_users AS ⟦misleading_name|view named inactive_users selects active users⟧
SELECT DISTINCT u.id FROM users u JOIN orders o ON o.user_id = u.id
WHERE o.created_at > now() - interval '1 year';

-- Delete test accounts.
DELETE FROM users WHERE email LIKE '%@example.com' OR 1 = 1; ⟦probable_bug|OR 1 = 1 deletes every user⟧

-- Daily order counts.
SELECT date_trunc('day', created_at) AS day, COUNT(*) AS n
FROM orders
GROUP BY day
ORDER BY day;

-- Look up an order by the id passed in from the app.
CREATE OR REPLACE FUNCTION order_by_id(p_id TEXT) RETURNS SETOF orders AS $$
BEGIN
  RETURN QUERY EXECUTE 'SELECT * FROM orders WHERE id = ' || p_id; ⟦security_risk@injection|dynamic SQL built by concatenating the parameter⟧
END;
$$ LANGUAGE plpgsql;

-- Recent paid orders, filtered per user.
SELECT o.id, o.total_cents
FROM orders o
WHERE o.status = 'paid'
  AND o.created_at >= now() - interval '7 days'
  AND o.user_id = 42;
`,
    `

-- Look up a user by the email passed in from the app.
CREATE OR REPLACE FUNCTION user_by_email(p_email TEXT) RETURNS SETOF users AS $$
BEGIN
  RETURN QUERY EXECUTE 'SELECT * FROM users WHERE email = ''' || p_email || '''';
END;
$$ LANGUAGE plpgsql;
`,
    `

-- Top spenders this quarter.
SELECT u.email, SUM(o.total_cents) AS spent
FROM users u
JOIN orders o ON o.user_id = u.id
WHERE o.created_at >= date_trunc('quarter', now())
   OR o.status = 'paid'
GROUP BY u.email
HAVING SUM(o.total_cents) >= 0
ORDER BY spent DESC;
`,
    "probable_bug",
  ),
  sample(
    "sh",
    "Bash",
    "deploy.sh",
    "bash",
    `
#!/usr/bin/env bash
set -euo pipefail

APP_NAME="orders-api"
RELEASE_DIR="/srv/releases"
DB_PASSWORD="hunter2-prod-2024" ⟦security_risk|hardcoded production password⟧

log() {
  echo "[$(date +%H:%M:%S)] $*"
}

usage() {
  echo "usage: $0 <version> [--dry-run]"
  exit 1
}

build_release() {
  local version="$1"
  local target="$RELEASE_DIR/$APP_NAME-$version"
  mkdir -p "$target"
  cp -r dist/. "$target/"
  echo "$target"
}

clean_old_releases() {
  local keep="$1"
  cd "$RELEASE_DIR"
  ls -t | tail -n +"$keep" | xargs rm -rf ⟦probable_bug|filenames with spaces break xargs rm⟧
}

wipe_release() {
  local dir="$1"
  rm -rf $dir/* ⟦security_risk@injection|unquoted variable in rm -rf; empty dir wipes /*⟧
}

run_migration() {
  local sql_file="$1"
  psql "postgres://app:$DB_PASSWORD@db/orders" -c "$(cat $sql_file)" ⟦security_risk@injection|unquoted, unchecked SQL file executed⟧
}

restart_service() {
  local name="$1"
  systemctl restart "$name"
  return 0
  log "restarted $name" ⟦dead_or_unreachable|statement after return⟧
}

is_healthy() {
  local url="$1"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "$url")
  local is_down=1
  if [ "$code" = "200" ]; then
    is_down=1 ⟦misleading_name|is_down set to 1 (true) when the service is up⟧
  fi
  return $is_down
}

wait_for_health() {
  local url="$1"
  local i
  for i in $(seq 1 30); do
    if is_healthy "$url"; then return 0; fi
    sleep 1
  done
  return 1
}

main() {
  [ $# -ge 1 ] || usage
  local version="$1"
  local target
  target=$(build_release "$version")
  log "built $target"
  run_migration "migrations/$version.sql"
  restart_service "$APP_NAME"
  wait_for_health "http://localhost:8080/health" || exit 1
  clean_old_releases 5
}

main "$@"
`,
    `

find_user() {
  local email=$1
  QUERY="SELECT * FROM users WHERE email = '"$email"'"
  psql "$DB_URL" -c "$QUERY"
}
`,
    `

rotate_logs() {
  local dir=$1
  cd $dir
  for f in $(ls *.log); do
    gzip $f
  done
  rm -rf $dir/*.gz
}
`,
    "probable_bug",
  ),
  sample(
    "rs",
    "Rust",
    "inventory.rs",
    "rust",
    `
use std::collections::HashMap;
use std::process::Command;

#[derive(Debug, Clone)]
pub struct Item {
    pub sku: String,
    pub qty: u32,
    pub price_cents: u64,
}

pub fn total_value(items: &[Item]) -> u64 {
    items.iter().map(|i| i.qty as u64 * i.price_cents).sum()
}

pub fn last_sku(items: &[Item]) -> &str {
    &items[items.len() - 1].sku ⟦probable_bug|panics on empty slice (len - 1 underflows)⟧
}

pub fn find_sku<'a>(items: &'a [Item], sku: &str) -> Option<&'a Item> {
    items.iter().find(|i| i.sku == sku)
}

pub fn merge(a: &[Item], b: &[Item]) -> Vec<Item> {
    let mut out = a.to_vec();
    for item in b {
        if !out.iter().any(|o| o.sku == item.sku) { ⟦performance_smell|linear scan inside loop; quadratic merge⟧
            out.push(item.clone());
        }
    }
    out
}

pub fn parse_qty(raw: &str) -> u32 {
    raw.trim().parse::<u32>().unwrap() ⟦probable_bug|unwrap on user input panics on bad data⟧
}

pub fn run_report(script: &str, user_arg: &str) -> String {
    let output = Command::new("sh").arg("-c").arg(format!("{} {}", script, user_arg)).output(); ⟦security_risk@injection|shell injection via format!ed argument⟧
    match output {
        Ok(o) => String::from_utf8_lossy(&o.stdout).into_owned(),
        Err(_) => String::new(),
    }
}

pub fn is_out_of_stock(item: &Item) -> bool {
    let in_stock = item.qty == 0; ⟦misleading_name|in_stock is true when qty is zero⟧
    in_stock
}

pub fn count_by_sku(items: &[Item]) -> HashMap<String, u32> {
    let mut counts = HashMap::new();
    for item in items {
        *counts.entry(item.sku.clone()).or_insert(0) += item.qty;
    }
    counts
}

pub fn discount(price_cents: u64, percent: u64) -> u64 {
    if percent > 100 {
        return price_cents;
    }
    price_cents - price_cents * percent / 100
}

pub fn admin_key() -> &'static str {
    "AKIAIOSFODNN7EXAMPLE" ⟦security_risk|hardcoded cloud access key⟧
}

pub fn restock(item: &mut Item, amount: u32) -> u32 {
    item.qty += amount;
    return item.qty;
    item.qty = 0; ⟦dead_or_unreachable|statement after return⟧
}

pub fn average_price(items: &[Item]) -> u64 {
    if items.is_empty() {
        return 0;
    }
    total_value(items) / items.len() as u64
}
`,
    `

pub fn fetch_item(conn: &Connection, sku: &str) -> String {
    let query = format!("SELECT * FROM items WHERE sku = '{}'", sku);
    conn.query(&query)
}
`,
    `

pub fn cheapest(items: &[Item]) -> &Item {
    let mut best = &items[0];
    for i in 0..=items.len() {
        if items[i].price_cents < best.price_cents {
            best = &items[i];
        }
    }
    best
}
`,
    "probable_bug",
  ),
];
