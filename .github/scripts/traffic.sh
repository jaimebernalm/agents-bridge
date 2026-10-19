#!/usr/bin/env bash
# Keeps GitHub's traffic numbers for this repo on the `stats` branch, one row per UTC day, because
# the traffic API only returns the last 14 days. Run daily by .github/workflows/traffic.yml.
#
#   TRAFFIC_TOKEN  reads /traffic: a fine-grained token with Administration: read (GITHUB_TOKEN can't)
#   GH_TOKEN       counts each day's workflow runs and writes the branch
#   DRY_RUN=1      writes the files to OUT_DIR and leaves the branch alone
#
# Locally: TRAFFIC_TOKEN=$(gh auth token) GH_TOKEN=$(gh auth token) DRY_RUN=1 bash .github/scripts/traffic.sh
#
# Nothing here clones the repo. Every clone counts in the numbers it records, actions/checkout
# included, so the branch is read through the contents API and written through the Git Data API.
set -euo pipefail

repo=${REPO:-${GITHUB_REPOSITORY:-jaimebernalm/agents-bridge}}
branch=${BRANCH:-stats}
self=.github/workflows/traffic.yml
out=${OUT_DIR:-$(mktemp -d)}
today=$(date -u +%F)
mkdir -p "$out"

: "${TRAFFIC_TOKEN:?set TRAFFIC_TOKEN to a fine-grained token with Administration: read on $repo}"

traffic() { GH_TOKEN=$TRAFFIC_TOKEN gh api "repos/$repo/traffic/$1"; }
clones=$(traffic clones)
views=$(traffic views)
referrers=$(traffic popular/referrers)
paths=$(traffic popular/paths)

# What the branch holds now. An empty parent means the branch doesn't exist yet.
parent=$(gh api "repos/$repo/git/matching-refs/heads/$branch" --jq ".[] | select(.ref == \"refs/heads/$branch\") | .object.sha")
base_tree=
existing=
if [[ -n $parent ]]; then
  base_tree=$(gh api "repos/$repo/git/commits/$parent" --jq .tree.sha)
  existing=$(gh api "repos/$repo/git/trees/$base_tree" --jq '.tree[].path')
fi
old() {
  if grep -qx "$1" <<<"$existing"; then
    gh api "repos/$repo/contents/$1?ref=$parent" -H 'Accept: application/vnd.github.raw'
  fi
}
old_traffic=$(old traffic.csv)
old_referrers=$(old referrers.csv)
old_paths=$(old paths.csv)

# date -> {clones, clone_uniques, views, view_uniques} for the 14 days the API returns.
fresh=$(jq -n --argjson c "$clones" --argjson v "$views" '
  reduce (($c.clones[] | {d: .timestamp[:10], k: {clones: .count, clone_uniques: .uniques}}),
          ($v.views[]  | {d: .timestamp[:10], k: {views: .count, view_uniques: .uniques}})) as $x
    ({}; .[$x.d] += $x.k)
  | map_values({clones: 0, clone_uniques: 0, views: 0, view_uniques: 0} + .)')

old_days=$(jq -Rn '
  [inputs | select(length > 0 and (startswith("date,") | not)) | split(",")]
  | map({key: .[0], value: {clones: .[1], clone_uniques: .[2], views: .[3], view_uniques: .[4], ci_runs: .[5]}})
  | from_entries' <<<"$old_traffic")

# Days not stored yet, plus the last two stored days, which GitHub may still revise. Older rows stay.
todo=$(jq -rn --argjson old "$old_days" --argjson fresh "$fresh" '
  (($old | keys)[-2:][0] // "") as $cut
  | $fresh | keys[] | select($old[.] == null or . >= $cut)')

# Workflow runs started on each of those days, without this workflow's own runs. Each run's
# checkouts, and the Vercel build behind each push, are clones of our own.
ci='{}'
for d in $todo; do
  n=$(gh api --paginate "repos/$repo/actions/runs?created=${d}T00:00:00Z..${d}T23:59:59Z&per_page=100" \
    --jq ".workflow_runs[] | select(.path != \"$self\") | .id" | wc -l | tr -d ' ')
  ci=$(jq --arg d "$d" --argjson n "$n" '.[$d] = $n' <<<"$ci")
done

jq -rn --argjson old "$old_days" --argjson fresh "$fresh" --argjson ci "$ci" '
  "date,clones,clone_uniques,views,view_uniques,ci_runs",
  ($old + ($ci | with_entries(.value = $fresh[.key] + {ci_runs: .value}))
   | to_entries | sort_by(.key)[]
   | [.key, .value.clones, .value.clone_uniques, .value.views, .value.view_uniques, .value.ci_runs]
   | map(tostring) | join(","))' >"$out/traffic.csv"

# Referrers and pages are 14-day totals, so each run adds a snapshot dated the day it ran.
snapshot() { # file, header, old contents, rows
  { echo "$2"; grep -v -e "^as_of," -e "^$today," <<<"$3" | grep . || true; [[ -z $4 ]] || echo "$4"; } >"$out/$1"
}
snapshot referrers.csv as_of,referrer,count,uniques "$old_referrers" \
  "$(jq -r --arg d "$today" '.[] | "\($d),\([.referrer, .count, .uniques] | @csv)"' <<<"$referrers")"
snapshot paths.csv as_of,path,title,count,uniques "$old_paths" \
  "$(jq -r --arg d "$today" '.[] | "\($d),\([.path, .title, .count, .uniques] | @csv)"' <<<"$paths")"

# Vercel deploys every branch it sees, and each deployment clones the repo. Root and site/, since
# Vercel reads vercel.json from the project's root directory.
echo '{ "git": { "deploymentEnabled": false } }' >"$out/vercel.json"

cat >"$out/README.md" <<EOF
# Traffic history

Written once a day by \`$self\` on \`main\`. GitHub's traffic API only keeps 14 days; this branch keeps
all of them. Days are UTC.

- \`traffic.csv\`: one row per day. \`clones\` and \`clone_uniques\` are GitHub's clone counts:
  \`/plugin marketplace add\` clones the repo, and so do CI checkouts and Vercel builds. \`views\` and
  \`view_uniques\` are page views on github.com. \`ci_runs\` counts the workflow runs started that day
  (this workflow's own excluded), so days with our own activity stand out.
- \`referrers.csv\` and \`paths.csv\`: GitHub's top referrers and pages over the 14 days ending \`as_of\`,
  one snapshot per run.

Each run rewrites the last two stored days, which GitHub revises afterwards; older rows stay as they are.
\`vercel.json\` (here and in \`site/\`) keeps Vercel from deploying this branch, since every deployment
clones the repo.
EOF

if [[ ${DRY_RUN:-} == 1 ]]; then
  echo "Dry run: files in $out"
  exit 0
fi

tree=$(jq -n --arg base "$base_tree" \
  --rawfile traffic "$out/traffic.csv" --rawfile referrers "$out/referrers.csv" \
  --rawfile paths "$out/paths.csv" --rawfile readme "$out/README.md" --rawfile vercel "$out/vercel.json" '
  {tree: [
    {path: "traffic.csv", content: $traffic}, {path: "referrers.csv", content: $referrers},
    {path: "paths.csv", content: $paths}, {path: "README.md", content: $readme},
    {path: "vercel.json", content: $vercel}, {path: "site/vercel.json", content: $vercel}
  ] | map(. + {mode: "100644", type: "blob"})}
  + if $base == "" then {} else {base_tree: $base} end' |
  gh api "repos/$repo/git/trees" --input - --jq .sha)

if [[ $tree == "$base_tree" ]]; then
  echo "No changes on $branch"
  exit 0
fi

latest=$(tail -n 1 "$out/traffic.csv" | cut -d, -f1)
commit=$(jq -n --arg tree "$tree" --arg parent "$parent" --arg msg "Traffic through $latest" '
  {message: $msg, tree: $tree, parents: (if $parent == "" then [] else [$parent] end)}' |
  gh api "repos/$repo/git/commits" --input - --jq .sha)

if [[ -n $parent ]]; then
  gh api -X PATCH "repos/$repo/git/refs/heads/$branch" -f sha="$commit" -F force=false --silent
else
  gh api "repos/$repo/git/refs" -f ref="refs/heads/$branch" -f sha="$commit" --silent
fi
echo "$branch is at $commit (traffic through $latest)"
