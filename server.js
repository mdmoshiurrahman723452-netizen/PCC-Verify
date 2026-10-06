const express = require("express");
const https = require("https");

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
// PCC PARSER
// ======================================================

function parsePCC(html, token) {

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

    /Father(?:'s)?\s*Name\s*[:\-]?\s*<b[^>]*>(.*?)<\/b>/i,

    /Father(?:'s)?\s*Name\s*[:\-]?\s*<strong[^>]*>(.*?)<\/strong>/i,

    /Father(?:'s)?\s*Name\s*[:\-]?\s*([^<\r\n]+)/i,

    /S\/O\s*[:\-]?\s*<b[^>]*>(.*?)<\/b>/i,

    /Son\s+of\s*[:\-]?\s*<b[^>]*>(.*?)<\/b>/i

];

for (const pattern of fatherPatterns) {

    const match = html.match(pattern);

    if (match) {

        const value = stripHtml(match[1]);

        // Avoid obvious wrong matches
        if (
            value &&
            value.toUpperCase() !== "BANGLADESH" &&
            value.toUpperCase() !== "JALALPUR" &&
            value.toUpperCase() !== "SYLHET"
        ) {
            fatherName = value;
            break;
        }
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
// HTTPS REQUEST FALLBACK
// ======================================================

function fetchPCCWithHttps(url) {

    return new Promise((resolve, reject) => {

        const request = https.get(
            url,
            {
                rejectUnauthorized: false,

                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36",

                    "Accept":
                        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

                    "Accept-Language":
                        "en-US,en;q=0.9",

                    "Cache-Control":
                        "no-cache",

                    "Pragma":
                        "no-cache"
                }
            },

            (response) => {

                let body = "";

                response.setEncoding("utf8");

                response.on("data", chunk => {
                    body += chunk;
                });

                response.on("end", () => {

                    resolve({
                        status: response.statusCode,
                        statusText: response.statusMessage || "",
                        url,
                        headers: response.headers,
                        body
                    });

                });

            }
        );


        request.setTimeout(30000, () => {

            request.destroy(
                new Error("PCC request timeout")
            );

        });


        request.on("error", error => {
            reject(error);
        });

    });
}


// ======================================================
// PCC API
// ======================================================

app.get("/api/pcc", async (req, res) => {

    const requestStarted = Date.now();

    try {

        const targetUrl = req.query.url;


        if (!targetUrl) {

            return res.status(400).json({
                success: false,
                message: "PCC URL is required"
            });

        }


        // --------------------------------------------------
        // URL VALIDATION
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


        console.log("");
        console.log("======================================");
        console.log("PCC REQUEST");
        console.log("======================================");
        console.log("Target URL:", targetUrl);
        console.log("Token:", token);
        console.log("Node:", process.version);
        console.log("======================================");


        // ==================================================
        // FIRST TRY: NORMAL FETCH
        // ==================================================

        let html = "";
        let responseStatus = 0;
        let responseStatusText = "";
        let finalUrl = targetUrl;

        try {

            console.log(
                "Trying normal Node fetch..."
            );


            const controller =
                new AbortController();


            const timeout =
                setTimeout(() => {
                    controller.abort();
                }, 30000);


            const response = await fetch(
                targetUrl,
                {
                    method: "GET",

                    redirect: "follow",

                    signal: controller.signal,

                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36",

                        "Accept":
                            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

                        "Accept-Language":
                            "en-US,en;q=0.9",

                        "Cache-Control":
                            "no-cache",

                        "Pragma":
                            "no-cache"
                    }
                }
            );


            clearTimeout(timeout);


            responseStatus =
                response.status;

            responseStatusText =
                response.statusText;

            finalUrl =
                response.url;


            if (response.ok) {

                html =
                    await response.text();

                console.log(
                    "Normal fetch successful."
                );

            }

        } catch (error) {

            console.log(
                "Normal fetch failed:",
                error.message
            );

        }


        // ==================================================
        // FALLBACK HTTPS
        // ==================================================

        if (!html) {

            console.log(
                "Trying HTTPS fallback..."
            );


            try {

                const result =
                    await fetchPCCWithHttps(
                        targetUrl
                    );


                responseStatus =
                    result.status;

                responseStatusText =
                    result.statusText;

                html =
                    result.body;


                console.log(
                    "HTTPS fallback status:",
                    result.status
                );


                if (
                    result.status < 200 ||
                    result.status >= 400
                ) {

                    return res.status(502).json({

                        success: false,

                        message:
                            "Official PCC server returned an HTTP error.",

                        status:
                            result.status,

                        statusText:
                            result.statusText

                    });

                }

            } catch (fallbackError) {

                console.log(
                    "HTTPS fallback failed:",
                    fallbackError.message
                );


                return res.status(502).json({

                    success: false,

                    message:
                        "Render server could not connect to the official PCC website.",

                    error:
                        fallbackError.message,

                    errorName:
                        fallbackError.name,

                    elapsedMs:
                        Date.now() -
                        requestStarted

                });

            }

        }


        // ==================================================
        // CHECK HTML
        // ==================================================

        if (!html || html.length < 100) {

            return res.status(502).json({

                success: false,

                message:
                    "Official PCC page returned an empty or incomplete response.",

                htmlLength:
                    html ? html.length : 0

            });

        }


        console.log(
            "PCC HTML LENGTH:",
            html.length
        );


        // ==================================================
        // PARSE
        // ==================================================

        const data =
            parsePCC(
                html,
                token
            );


        console.log("");
        console.log("======================================");
        console.log("PCC PARSED DATA");
        console.log("======================================");
        console.log(data);
        console.log("======================================");


        // ==================================================
        // RETURN
        // ==================================================

        return res.json({

            success: true,

            data,

            source:
                "pcc.police.gov.bd",

            finalUrl,

            httpStatus:
                responseStatus,

            responseStatusText,

            responseLength:
                html.length,

            elapsedMs:
                Date.now() -
                requestStarted

        });


    } catch (error) {

        console.log(
            "Unexpected PCC error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Official PCC page could not be read.",

            error:
                error.message,

            errorName:
                error.name,

            cause:
                error.cause?.message || null

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
// TEST
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
    console.log("PORT:", PORT);
    console.log("Node:", process.version);
    console.log("======================================");

});
