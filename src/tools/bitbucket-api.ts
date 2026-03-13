import { config } from "../config.js";

const BASE_URL = "https://api.bitbucket.org/2.0";

function authHeader(): string {
  const credentials = Buffer.from(
    `${config.bitbucket.email}:${config.bitbucket.apiToken}`,
  ).toString("base64");
  return `Basic ${credentials}`;
}

function resolveWorkspace(workspace?: string): string {
  const ws = workspace || config.bitbucket.defaultWorkspace;
  if (!ws) throw new Error("No workspace specified and no default configured (BITBUCKET_WORKSPACE)");
  return ws;
}

function resolveRepo(repoSlug?: string): string {
  const repo = repoSlug || config.bitbucket.defaultRepoSlug;
  if (!repo) throw new Error("No repo_slug specified and no default configured (BITBUCKET_REPO_SLUG)");
  return repo;
}

async function request(
  path: string,
  accept = "application/json",
): Promise<Response> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: authHeader(),
      Accept: accept,
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    switch (res.status) {
      case 401:
        throw new Error(`Authentication failed (401). Verify BITBUCKET_EMAIL and BITBUCKET_API_TOKEN. ${body}`);
      case 403:
        throw new Error(`Permission denied (403). Check repository access permissions. ${body}`);
      case 404:
        throw new Error(`Not found (404). Verify workspace, repo slug, and PR ID. ${body}`);
      case 429:
        throw new Error(`Rate limit exceeded (429). Try again later. ${body}`);
      default:
        throw new Error(`Bitbucket API error ${res.status}: ${body}`);
    }
  }

  return res;
}

export interface BitbucketPR {
  id: number;
  title: string;
  description: string;
  state: string;
  author: { display_name: string; nickname: string };
  source: { branch: { name: string } };
  destination: { branch: { name: string } };
  reviewers: { display_name: string; nickname: string }[];
  created_on: string;
  updated_on: string;
  links: { html: { href: string } };
}

export interface BitbucketComment {
  id: number;
  content: { raw: string };
  user: { display_name: string; nickname: string };
  created_on: string;
  inline?: { path: string; to: number | null; from: number | null };
  parent?: { id: number };
}

export class BitbucketClient {
  async listPRs(
    workspace?: string,
    repoSlug?: string,
    state?: string,
  ): Promise<{ values: BitbucketPR[] }> {
    const ws = resolveWorkspace(workspace);
    const repo = resolveRepo(repoSlug);
    const query = state ? `?state=${state}` : "";
    const res = await request(
      `/repositories/${ws}/${repo}/pullrequests${query}`,
    );
    return res.json() as Promise<{ values: BitbucketPR[] }>;
  }

  async getPR(
    prId: string,
    workspace?: string,
    repoSlug?: string,
  ): Promise<BitbucketPR> {
    const ws = resolveWorkspace(workspace);
    const repo = resolveRepo(repoSlug);
    const res = await request(
      `/repositories/${ws}/${repo}/pullrequests/${prId}`,
    );
    return res.json() as Promise<BitbucketPR>;
  }

  async getPRDiff(
    prId: string,
    workspace?: string,
    repoSlug?: string,
  ): Promise<string> {
    const ws = resolveWorkspace(workspace);
    const repo = resolveRepo(repoSlug);
    const res = await request(
      `/repositories/${ws}/${repo}/pullrequests/${prId}/diff`,
      "text/plain",
    );
    return res.text();
  }

  async getPRComments(
    prId: string,
    workspace?: string,
    repoSlug?: string,
  ): Promise<{ values: BitbucketComment[] }> {
    const ws = resolveWorkspace(workspace);
    const repo = resolveRepo(repoSlug);
    const res = await request(
      `/repositories/${ws}/${repo}/pullrequests/${prId}/comments`,
    );
    return res.json() as Promise<{ values: BitbucketComment[] }>;
  }
}
