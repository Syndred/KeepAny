// Used by publication only. Daily feedback never satisfies release acceptance.
export const requiredReleaseJobs = [
  "verify",
  "portable-workflows",
  "account-layout / account-layout",
  "vault-tools / vault-tools",
  ...["ubuntu-latest", "macos-latest", "windows-latest"].map(os => `preview-platforms / preview (${os})`),
];

export async function requireFullRelease({ github, owner, repo, sha }) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw Error("A full release source SHA is required.");
  const runs = await github.paginate(github.rest.actions.listWorkflowRuns, {
    owner, repo, workflow_id: "verify.yml", head_sha: sha, per_page: 100,
  });
  const run = runs.filter(row => row.head_sha === sha &&
    row.path === ".github/workflows/verify.yml" &&
    row.name === "Verify local release" && row.event === "workflow_dispatch")
    .sort((a, b) => b.id - a.id)[0];
  if (!run || run.status !== "completed" || run.conclusion !== "success") {
    throw Error(`Full manual release checks must pass on ${sha} before publishing.`);
  }
  const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
    owner, repo, run_id: run.id, filter: "latest", per_page: 100,
  });
  for (const name of requiredReleaseJobs) {
    const matches = jobs.filter(job => job.name === name);
    if (matches.length !== 1 || matches[0].status !== "completed" || matches[0].conclusion !== "success") {
      throw Error(`Full release job must succeed without skipping: ${name} (${sha}).`);
    }
  }
  return run;
}
