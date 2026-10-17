// Runs inside the LeetCode tab (injected with chrome.scripting only when you press Push), so the
// requests carry your LeetCode session. It must stay self-contained: Chrome serializes the function.
//
// On /problems/<slug>/submissions/<id>/ it loads that submission; on any other problem page it
// loads your latest accepted submission for that problem.

export async function collectSubmission(pathname) {
  const LIST = `query submissionList($offset: Int!, $limit: Int!, $lastKey: String, $questionSlug: String!, $status: Int) {
    questionSubmissionList(offset: $offset, limit: $limit, lastKey: $lastKey, questionSlug: $questionSlug, status: $status) {
      submissions { id statusDisplay }
    }
  }`;
  const DETAILS = `query submissionDetails($submissionId: Int!) {
    submissionDetails(submissionId: $submissionId) {
      runtimeDisplay runtimePercentile memoryDisplay memoryPercentile
      code timestamp statusCode notes
      lang { name verboseName }
      question { questionId questionFrontendId title titleSlug content difficulty topicTags { name slug } }
    }
  }`;

  async function gql(query, variables) {
    const csrf = (document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1];
    const res = await fetch('/graphql/', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...(csrf ? { 'x-csrftoken': csrf } : {}) },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`LeetCode returned error ${res.status}`);
    const json = await res.json();
    if (json.errors && json.errors.length) throw new Error(json.errors[0].message);
    return json.data;
  }

  try {
    const problem = /^\/problems\/([^/]+)/.exec(pathname);
    if (!problem) return { error: 'Open a LeetCode problem first' };
    let id = (/^\/problems\/[^/]+\/submissions\/(\d+)/.exec(pathname) || [])[1];
    if (!id) {
      const list = await gql(LIST, { questionSlug: problem[1], offset: 0, limit: 20, lastKey: null, status: 10 });
      const subs = (list && list.questionSubmissionList && list.questionSubmissionList.submissions) || [];
      const accepted = subs.find((s) => s.statusDisplay === 'Accepted') || subs[0];
      if (!accepted) return { error: 'No accepted submission for this problem yet' };
      id = accepted.id;
    }
    const data = await gql(DETAILS, { submissionId: Number(id) });
    const sub = data && data.submissionDetails;
    if (!sub || !sub.code) return { error: 'Sign in to LeetCode to push your submissions' };
    if (sub.statusCode !== 10) return { error: 'This submission was not accepted' };
    return { submissionId: String(id), submission: sub };
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
}
