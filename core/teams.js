// Map every CODEOWNERS owner to its members. Teams in `org` are resolved with
// `fetchMembers(org, slug)`; anything else (a user, an email, another org's
// team) becomes a pseudo-team containing only itself.
export const resolveOwnerTeams = async (org, folderOwners, fetchMembers) => {
  const allOwners = Array.from(
    new Set(folderOwners.flatMap(({owners}) => Array.from(owners)))
  );

  const prefix = `@${org}/`;
  const teamNames = allOwners.filter((name) => name.startsWith(prefix));

  const orgTeams = new Map(
    await Promise.all(
      teamNames.map(async (teamName) => [
        teamName,
        await fetchMembers(org, teamName.slice(prefix.length)),
      ])
    )
  );

  return new Map(allOwners.map((name) => [name, orgTeams.get(name) || [name]]));
};
