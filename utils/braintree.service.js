import braintree from 'braintree'

export const gateway = new braintree.BraintreeGateway({
  environment: braintree.Environment.Sandbox, // change to Production later
  merchantId: process.env.MERCHANT_ID,
  publicKey: process.env.PUBLIC_KEY,
  privateKey: process.env.PRIVATE_KEY,
})

export const generateClientToken = async () => {
  return gateway.clientToken.generate({})
}

export const processTransaction = async (
  amount,
  paymentMethodNonce
) => {
  return gateway.transaction.sale({
    amount,
    paymentMethodNonce,
    options: {
      submitForSettlement: true,
    },
  })
}
