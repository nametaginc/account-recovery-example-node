import http from 'http';
import express, { Request, Response, NextFunction } from 'express';

const router = express();
router.use(express.urlencoded({ extended: false }));

const CLIENT_ID = "{{< var YOUR_CLIENT_ID >}}"
const CLIENT_SECRET = "{{< var YOUR_CLIENT_SECRET >}}"

interface Account {
    email: string
    name: string
}

// fake accounts database
var accounts: Account[] = [
    {
        email: "alice@example.com",
        // if you put your name here, recovery will work. 
        // or, you can put someone else's name if you want it to fail.
        name: "{{< var YOUR_NAME_FOR_TESTING >}}",
    },
]

const getRoot = async (req: Request, res: Response, next: NextFunction) => {
    return res.status(200).type("text/html").send(`
<html>
    <head>
        <style>input, button, a { display: block; margin: 10px 0 }</style>
    </head>
    <body>
        <h1>Example login page</h1>
        <form method="post" action="/recover/start">
            <input type="text" name="email" placeholder="Email" value="alice@example.com">
            <button>I forgot my password</button>
            
            <div><strong>Demo note(s)</strong></div>
            ${accounts.map(a => `<div>${a.email} can be recovered only by ${a.name}</div>`)}
        </form>
    </body>
</html>`)
};
router.get('/', getRoot)

const handleRecoverStart = async (req: Request, res: Response, next: NextFunction) => {
    const state = req.body["email"]

    const query = new URLSearchParams()
    query.append("client_id", CLIENT_ID)
    query.append("redirect_uri", "http://localhost:6060/recover/finish")
    query.append("scope", "login nt:legal_name")
    query.append("state", state)

    let authorizeURL = "https://nametag.co/authorize?" + query.toString()
    return res.status(200).redirect(authorizeURL.toString())
};
router.post('/recover/start', handleRecoverStart)

const verifyCode = async (code: string): Promise<string> => {
    const tokenRequest = new URLSearchParams();
    tokenRequest.set("grant_type",  "authorization_code")
    tokenRequest.set("client_id", CLIENT_ID)
    tokenRequest.set("client_secret",  CLIENT_SECRET)
    tokenRequest.set("redirect_uri",  "http://localhost:6060/recover/finish")
    tokenRequest.set("code",  code)
    const tokenHttpResponse = await fetch("https://nametag.co/token", {
        method: "POST",
        body: tokenRequest
    })
    const tokenResponse = await tokenHttpResponse.json()
    if (tokenResponse["error"]) {
        throw new Error(`${tokenResponse["error"]} ${tokenResponse["error_description"]}`)
    }
    return tokenResponse["subject"] as string
}

const compareName = async (subject: string, expectedName: string): Promise<number> => {
    const compareHttpResponse = await fetch(`https://nametag.co/people/${encodeURIComponent(subject)}/compare?token=${encodeURI(CLIENT_SECRET)}`,
        {
            method: "POST",
            body: JSON.stringify({
                expectations: [
                    {
                        "scope": "nt:legal_name",
                        "value": expectedName
                    }
                ]
            })
        })

    const compareResponse = await compareHttpResponse.json()
    return compareResponse["confidence"] as number
}

const handleRecoverFinish = async (req: Request, res: Response, next: NextFunction) => {
    if (req.query["error"]) {
        return res.status(400).send(`Error: ${req.query["error"]}`)
    }
    const code = req.query["code"] as string
    const state = req.query["state"] as string

    // call the Nametag API to verify code and fetch subject
    let subject: string
    try {
        subject = await verifyCode(code)
    } catch (e) {
        return res.status(400).send(`Error: ${e}`)
    }

    // Use state to find the user's account
    const account = accounts.find(a => a.email === state)
    if (!account) {
        return res.status(400).send(`Error: account does not exist`)
    }

    // call the Nametag API to compare the expected name in account to the one on their ID.
    const matchConfidence = await compareName(subject, account.name)
    if (matchConfidence < 0.75) {
        return res.status(403).send(`Error: name does not match`)
    }
  
    // TODO: reset the password

    return res.status(200).send(`Success! Your account is reset.`)
};
router.get('/recover/finish', handleRecoverFinish)

const httpServer = http.createServer(router);
const PORT = 6060
httpServer.listen(PORT, () => console.log(`The server is running on port ${PORT}`));