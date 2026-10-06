const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));


// ======================================================
// TEXT CLEANER
// ======================================================

function cleanText(text) {
    if (!text) return "";

    return String(text)
        .replace(/\s+/g, " ")
        .replace(/&nbsp;/gi, " ")
        .trim();
}


// ======================================================
// REMOVE HTML
// ======================================================

function stripHtml(text) {
    if (!text) return "";

    return cleanText(
        String(text)
            .replace(/<br\s*\/?>/gi, " ")
            .replace(/<\/p>/gi, " ")
            .replace(/<[^>]*>/g, " ")
    );
}


// ======================================================
// EXTRACT BOLD VALUE
// ======================================================

function getBoldAfter(html, textBefore) {

    const escaped = textBefore.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
    );

    const regex = new RegExp(
        escaped + "[\\s\\S]*?<b[^>]*>(.*?)<\\/b>",
        "i"
    );

    const match = html.match(regex);

    if (!match) {
        return "";
    }

    return stripHtml(match[1]);
}


// ======================================================
// PCC PARSER
// ======================================================

function parsePCC(html, token) {

    // --------------------------------------------------
    // Dated
    // --------------------------------------------------

    let dated = "";

    const datedPatterns = [
        /Dated:\s*([^<\r\n]+)/i,
        /Dated\s*:\s*([^<\r\n]+)/i
    ];

    for (const pattern of datedPatterns) {

        const match = html.match(pattern);

        if (match) {
            dated = cleanText(match[1]);
            break;
        }
    }


    // --------------------------------------------------
    // Applicant Name
    // --------------------------------------------------

    let applicantName = "";

    const applicantPatterns = [
        /character and antecedents of\s+Mr\.\s*<b[^>]*>(.*?)<\/b>/i,
        /character and antecedents of\s+Mr\.\s*<strong[^>]*>(.*?)<\/strong>/i,
        /character and antecedents of\s+Mr\.\s*([^<]+)/i
    ];

    for (const pattern of applicantPatterns) {

        const match = html.match(pattern);

        if (match) {
            applicantName = stripHtml(match[1]);
            break;
        }
    }


    // --------------------------------------------------
    // Father Name
    // --------------------------------------------------

    let fatherName = "";

    const fatherPatterns = [
        /of\s*<b[^>]*>(.*?)<\/b>/i,
        /Father(?:'s)?\s*Name\s*:?\s*<b[^>]*>(.*?)<\/b>/i
    ];

    for (const pattern of fatherPatterns) {

        const match = html.match(pattern);

        if (match) {
            fatherName = stripHtml(match[1]);
            break;
        }
    }


    // --------------------------------------------------
    // P/O
    // --------------------------------------------------

    let po = "";

    const poMatch = html.match(
        /P\/O\s*:\s*<b[^>]*>(.*?)<\/b>/i
    );

    if (poMatch) {
        po = stripHtml(poMatch[1]);
    }


    // --------------------------------------------------
    // Post Code
    // --------------------------------------------------

    let postCode = "";

    const postCodeMatch = html.match(
        /Post\s*Code\s*:\s*<b[^>]*>(.*?)<\/b>/i
    );

    if (postCodeMatch) {
        postCode = stripHtml(postCodeMatch[1]);
    }


    // --------------------------------------------------
    // P/S
    // --------------------------------------------------

    let ps = "";

    const psMatch = html.match(
        /P\/S\s*:\s*<b[^>]*>(.*?)<\/b>/i
    );

    if (psMatch) {
        ps = stripHtml(psMatch[1]);
    }


    // --------------------------------------------------
    // District
    // --------------------------------------------------

    let district = "";

    const districtMatch = html.match(
        /District\s*:\s*<b[^>]*>(.*?)<\/b>/i
    );

    if (districtMatch) {
        district = stripHtml(districtMatch[1]);
    }


    // --------------------------------------------------
    // Passport Number
    // --------------------------------------------------

    let passportNo = "";

    const passportPatterns = [
        /International Passport No\.\s*<b[^>]*>(.*?)<\/b>/i,
        /International Passport No\s*:\s*<b[^>]*>(.*?)<\/b>/i,
        /Passport No\.\s*:\s*<b[^>]*>(.*?)<\/b>/i
    ];

    for (const pattern of passportPatterns) {

        const match = html.match(pattern);

        if (match) {
            passportNo = stripHtml(match[1]);
            break;
        }
    }


    return {
        refNo: token,
        dated,
        applicantName,
        fatherName,
        po,
        postCode,
        ps,
        district,
        passportNo
    };
}


// ======================================================
// PCC API
// ======================================================

app.get("/api/pcc", async (req, res) => {

    const requestStarted = Date.now();

    try {

        const targetUrl = req.query.url;


        // --------------------------------------------------
        // URL REQUIRED
        // --------------------------------------------------

        if (!targetUrl) {

            return res.status(400).json({
                success: false,
                message: "PCC URL is required"
            });
        }


        // --------------------------------------------------
        // PARSE URL
        // --------------------------------------------------

        let parsedUrl;

        try {

            parsedUrl = new URL(targetUrl);

        } catch (error) {

            return res.status(400).json({
                success: false,
                message: "Invalid URL",
                error: error.message
            });
        }


        // --------------------------------------------------
        // OFFICIAL PCC DOMAIN ONLY
        // --------------------------------------------------

        if (parsedUrl.hostname !== "pcc.police.gov.bd") {

            return res.status(400).json({
                success: false,
                message: "Invalid PCC website"
            });
        }


        // --------------------------------------------------
        // GET TOKEN
        // --------------------------------------------------

        let token =
            parsedUrl.searchParams.get("P50_TOKEN_ID");


        if (!token) {

            const tokenMatch = targetUrl.match(
                /P50_TOKEN_ID[:=]([A-Za-z0-9_-]+)/i
            );

            if (tokenMatch) {
                token = tokenMatch[1];
            }
        }


        if (!token) {

            return res.status(400).json({
                success: false,
                message: "Reference token not found"
            });
        }


        // --------------------------------------------------
        // LOG REQUEST
        // --------------------------------------------------

        console.log("");
        console.log("======================================");
        console.log("PCC REQUEST");
        console.log("======================================");
        console.log("Target URL:", targetUrl);
        console.log("Hostname:", parsedUrl.hostname);
        console.log("Token:", token);
        console.log("Node Version:", process.version);
        console.log("Time:", new Date().toISOString());
        console.log("======================================");


        // --------------------------------------------------
        // ABORT CONTROLLER
        // --------------------------------------------------

        const controller = new AbortController();

        const timeout = setTimeout(() => {

            console.log("PCC REQUEST TIMEOUT");

            controller.abort();

        }, 30000);


        let response;


        // --------------------------------------------------
        // FETCH OFFICIAL PCC PAGE
        // --------------------------------------------------

        try {

            console.log("Connecting to PCC server...");

            response = await fetch(targetUrl, {

                method: "GET",

                redirect: "follow",

                signal: controller.signal,

                headers: {

                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",

                    "Accept":
                        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",

                    "Accept-Language":
                        "en-US,en;q=0.9",

                    "Cache-Control":
                        "no-cache",

                    "Pragma":
                        "no-cache",

                    "Upgrade-Insecure-Requests":
                        "1"
                }

            });

        } catch (fetchError) {

            clearTimeout(timeout);


            console.log("");
            console.log("======================================");
            console.log("PCC FETCH ERROR");
            console.log("======================================");

            console.log("Name:", fetchError.name);
            console.log("Message:", fetchError.message);
            console.log("Code:", fetchError.code);
            console.log("Cause:", fetchError.cause);
            console.log(
                "Cause Name:",
                fetchError.cause?.name
            );
            console.log(
                "Cause Message:",
                fetchError.cause?.message
            );
            console.log(
                "Cause Code:",
                fetchError.cause?.code
            );

            console.log("======================================");


            return res.status(502).json({

                success: false,

                message:
                    "Render server could not connect to the official PCC website.",

                error: fetchError.message,

                errorName: fetchError.name,

                errorCode:
                    fetchError.code ||
                    fetchError.cause?.code ||
                    null,

                cause:
                    fetchError.cause?.message ||
                    null,

                elapsedMs:
                    Date.now() - requestStarted
            });
        }


        clearTimeout(timeout);


        // --------------------------------------------------
        // RESPONSE INFORMATION
        // --------------------------------------------------

        console.log("");
        console.log("======================================");
        console.log("PCC RESPONSE");
        console.log("======================================");

        console.log("HTTP STATUS:", response.status);
        console.log("STATUS TEXT:", response.statusText);
        console.log("FINAL URL:", response.url);
        console.log(
            "CONTENT TYPE:",
            response.headers.get("content-type")
        );

        console.log("======================================");


        // --------------------------------------------------
        // HTTP ERROR
        // --------------------------------------------------

        if (!response.ok) {

            return res.status(502).json({

                success: false,

                message:
                    "Official PCC server returned an HTTP error.",

                status:
                    response.status,

                statusText:
                    response.statusText,

                finalUrl:
                    response.url
            });
        }


        // --------------------------------------------------
        // READ HTML
        // --------------------------------------------------

        const html = await response.text();


        console.log(
            "PCC HTML LENGTH:",
            html.length
        );


        if (!html || html.length < 100) {

            return res.status(502).json({

                success: false,

                message:
                    "Official PCC page returned an empty or incomplete response.",

                htmlLength:
                    html.length
            });
        }


        // --------------------------------------------------
        // PARSE PCC
        // --------------------------------------------------

        const data = parsePCC(
            html,
            token
        );


        console.log("");
        console.log("======================================");
        console.log("PCC PARSED DATA");
        console.log("======================================");

        console.log(data);

        console.log("======================================");


        // --------------------------------------------------
        // RETURN DATA
        // --------------------------------------------------

        return res.json({

            success: true,

            data: data,

            source: "pcc.police.gov.bd",

            finalUrl: response.url,

            httpStatus: response.status,

            responseLength: html.length,

            elapsedMs:
                Date.now() - requestStarted
        });


    } catch (error) {


        console.log("");
        console.log("======================================");
        console.log("UNEXPECTED PCC ERROR");
        console.log("======================================");

        console.log("Name:", error.name);
        console.log("Message:", error.message);
        console.log("Stack:", error.stack);
        console.log("Cause:", error.cause);

        console.log("======================================");


        return res.status(500).json({

            success: false,

            message:
                "Official PCC page could not be read.",

            error:
                error.message,

            errorName:
                error.name,

            cause:
                error.cause?.message ||
                null
        });
    }
});


// ======================================================
// HEALTH CHECK
// ======================================================

app.get("/api/health", (req, res) => {

    res.json({

        success: true,

        message:
            "PCC Verify Server is running",

        nodeVersion:
            process.version,

        port:
            PORT
    });
});


// ======================================================
// ROOT TEST
// ======================================================

app.get("/api/test", (req, res) => {

    res.json({

        success: true,

        message:
            "PCC Verify API is working",

        serverTime:
            new Date().toISOString(),

        nodeVersion:
            process.version
    });
});


// ======================================================
// START SERVER
// ======================================================

app.listen(PORT, () => {

    console.log("");
    console.log("======================================");
    console.log("PCC VERIFY SERVER RUNNING");
    console.log("======================================");
    console.log(
        "PORT:",
        PORT
    );
    console.log(
        "Open: http://localhost:" + PORT
    );
    console.log(
        "Node:",
        process.version
    );
    console.log("======================================");

});
