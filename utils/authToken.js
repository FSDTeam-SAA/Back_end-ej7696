import jwt from 'jsonwebtoken';


export const createToken = (
  jwtPayload,
  secret,
  expiresIn,
) => {
  const options = { expiresIn: expiresIn };
  return jwt.sign(jwtPayload, secret, options);
};


export const verifyToken = (
  token,
  secret
)=> {
  return jwt.verify(token, secret) ;
};
