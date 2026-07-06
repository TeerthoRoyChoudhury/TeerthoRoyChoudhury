const QUERY = `
query ($login: String!) {
  user(login: $login) {
    contributionsCollection {
      totalCommitContributions
      totalIssueContributions
      totalPullRequestContributions
      totalPullRequestReviewContributions
      contributionCalendar {
        weeks {
          contributionDays {
            contributionCount
            date
          }
        }
      }
    }

    ownedRepos: repositories(
      first: 1
      affiliations: OWNER
      isFork: false
    ) {
      totalCount
    }

    repositories(
      first: 100
      affiliations: OWNER
      isFork: false
      orderBy: { field: UPDATED_AT, direction: DESC }
    ) {
      nodes {
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges {
            size
            node {
              name
              color
            }
          }
        }
      }
    }
  }
}
`;
