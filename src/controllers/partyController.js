// Party controller deprecated.
// Party accounts are now represented by `User` documents with `role: 'party'`.
// Use the existing user endpoints for creating/listing distributor-created party accounts:
// - POST /api/v1/users/distributor-create-user  (accepts `partyCode`)
// - GET  /api/v1/users/distributor-users        (lists users created by distributor)

export const createParty = async (req, res) => {
  return res.status(410).json({
    error: 'Deprecated. Use /api/v1/users/distributor-create-user with `partyCode` instead.'
  });
};

export const listParties = async (req, res) => {
  return res.status(410).json({
    error: 'Deprecated. Use /api/v1/users/distributor-users instead.'
  });
};

export default {
  createParty,
  listParties,
};
