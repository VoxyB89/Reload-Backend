const express = require("express");
const mongoose = require("mongoose");
const fs = require("fs");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const path = require("path");
const kv = require("./structs/kv.js");
const config = JSON.parse(fs.readFileSync("./Config/config.json").toString());

const log = require("./structs/log.js");
const error = require("./structs/error.js");
const functions = require("./structs/functions.js");
const CheckForUpdate = require("./structs/checkforupdate.js");
const AutoBackendRestart = require("./structs/autobackendrestart.js");

const app = express();

if (!fs.existsSync("./ClientSettings")) fs.mkdirSync("./ClientSettings");

global.JWT_SECRET = functions.MakeID();
const PORT = config.port;
const WEBSITEPORT = config.Website.websiteport;

// Check if HTTPS is enabled
let httpsServer;
if (config.bEnableHTTPS) {
    const https = require('https'); // Import the https module

    // Load SSL certificate options from config
    const httpsOptions = {
        cert: fs.readFileSync(config.ssl.cert),
        ca: fs.existsSync(config.ssl.ca) ? fs.readFileSync(config.ssl.ca) : undefined, // Optional
        key: fs.readFileSync(config.ssl.key)
    };

    httpsServer = https.createServer(httpsOptions, app);
}

if (!fs.existsSync("./ClientSettings")) fs.mkdirSync("./ClientSettings");

global.JWT_SECRET = functions.MakeID();

console.log('Welcome to Reload Backend\n');

const tokens = JSON.parse(fs.readFileSync("./tokenManager/tokens.json").toString());

for (let tokenType in tokens) {
    for (let tokenIndex in tokens[tokenType]) {
        let decodedToken = jwt.decode(tokens[tokenType][tokenIndex].token.replace("eg1~", ""));

        if (DateAddHours(new Date(decodedToken.creation_date), decodedToken.hours_expire).getTime() <= new Date().getTime()) {
            tokens[tokenType].splice(Number(tokenIndex), 1);
        }
    }
}

fs.writeFileSync("./tokenManager/tokens.json", JSON.stringify(tokens, null, 2));

global.accessTokens = tokens.accessTokens;
global.refreshTokens = tokens.refreshTokens;
global.clientTokens = tokens.clientTokens;
global.kv = kv;

global.exchangeCodes = [];

let updateFound = false;

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "./package.json")).toString());
if (!packageJson) throw new Error("Failed to parse package.json");
const version = packageJson.version;

const checkUpdates = async () => {
    if (updateFound) return;

    try {
        const updateAvailable = await CheckForUpdate.checkForUpdate(version);
        if (updateAvailable) {
            updateFound = true;
        }
    } catch (err) {
        log.error("Failed to check for updates");
    }
};

checkUpdates();

setInterval(checkUpdates, 60000);

mongoose.set('strictQuery', true);

mongoose.connect(config.mongodb.database, () => {
    log.backend("App successfully connected to MongoDB!");
});

mongoose.connection.on("error", err => {
    log.error("MongoDB failed to connect, please make sure you have MongoDB installed and running.");
    throw err;
});

app.use(rateLimit({ windowMs: 0.5 * 60 * 1000, max: 45 }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

fs.readdirSync("./routes").forEach(fileName => {
    try {
        app.use(require(`./routes/${fileName}`));
    } catch (err) {
        log.error(`Routes Error: Failed to load ${fileName}`)
    }
});

fs.readdirSync("./Api").forEach(fileName => {
    try {
        app.use(require(`./Api/${fileName}`));
    } catch (err) {
        log.error(`Reload API Error: Failed to load ${fileName}`)
    }
});

app.get("/unknown", (req, res) => {
    log.debug('GET /unknown endpoint called');
    res.json({ msg: "Reload Backend - Made by Burlone" });
});

// Start the server
const startServer = (server) => {
    server.listen(PORT, () => {
        log.backend(`Backend started listening on port ${PORT}`);

        // Load additional modules
        require("./xmpp/xmpp.js");
        if (config.discord.bUseDiscordBot === true) {
            require("./DiscordBot");
        }
        
        if (config.bUseAutoRotate === true) {
            require("./structs/autorotate.js");
        }

    }).on("error", async (err) => {
        if (err.code === "EADDRINUSE") {
            log.error(`Port ${PORT} is already in use!\nClosing in 3 seconds...`);
            await functions.sleep(3000);
            process.exit(0);
        } else {
            throw err;
        }
    });
};

// Check if HTTPS is enabled
if (config.bEnableHTTPS) {
    const httpsOptions = {
        cert: fs.readFileSync(config.ssl.cert),
        ca: fs.existsSync(config.ssl.ca) ? fs.readFileSync(config.ssl.ca) : undefined, // Optional
        key: fs.readFileSync(config.ssl.key)
    };

    const httpsServer = https.createServer(httpsOptions, app);
    wss = new WebSocket({ server: httpsServer });

    // Start the HTTPS server
    startServer(httpsServer);
} else {
    // Start the HTTP server
    wss = new WebSocket({ server: app.listen(PORT) });
    startServer(app);
}

if (config.bEnableAutoBackendRestart === true) {
    AutoBackendRestart.scheduleRestart(config.bRestartTime);
}

if (config.Website.bUseWebsite === true) {
    const websiteApp = express();
    require('./Website/website')(websiteApp);

    websiteApp.listen(WEBSITEPORT, () => {
        log.website(`Website started listening on port ${WEBSITEPORT}`);
    }).on("error", async (err) => {
        if (err.code === "EADDRINUSE") {
            log.error(`Website port ${WEBSITEPORT} is already in use!\nClosing in 3 seconds...`);
            await functions.sleep(3000);
            process.exit(1);
        } else {
            throw err;
        }
    });
}

app.use((req, res, next) => {
    const url = req.originalUrl;
    log.debug(`Missing endpoint: ${req.method} ${url} request port ${req.socket.localPort}`);
    if (req.url.includes("..")) {
        res.redirect("https://youtu.be/dQw4w9WgXcQ");
        return;
    }
    error.createError(
        "errors.com.epicgames.common.not_found", 
        "Sorry the resource you were trying to find could not be found", 
        undefined, 1004, undefined, 404, res
    );
});

function DateAddHours(pdate, number) {
    let date = pdate;
    date.setHours(date.getHours() + number);

    return date;
}

module.exports = app;
