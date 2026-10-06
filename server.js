const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

function cleanText(text) {
    return text
        .replace(/\s+/g, " ")
        .replace(/&nbsp;/gi, " ")
        .trim();
}

function getBetween(html, start, end) {
    const startIndex = html.indexOf(start);

    if (startIndex === -1) {
        return "";
    }

    const valueStart = startIndex + start.length;
    const endIndex = html.indexOf(end, valueStart);

    if (endIndex === -1) {
        return "";
    }

    return cleanText(
        html.substring(valueStart, endIndex)
            .replace(/<[^>]*>/g, " ")
    );
}

function getBoldAfter(html, textBefore) {
    const regex = new RegExp(
        textBefore.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
        "[\\s\\S]*?<b>(.*?)<\\/b>",
        "i"
    );

    const match = html.match(regex);

    if (!match) {
        return "";
    }

    return cleanText(match[1].replace(/<[^>]*>/g, " "));
}

function parsePCC(html, token) {

    // Dated
    const datedMatch = html.match(
        /Dated:\s*([^<]+)/i
    );

    const dated = datedMatch
        ? cleanText(datedMatch[1])
        : "";

    // Applicant Name
    const applicantMatch = html.match(
        /character and antecedents of\s+Mr\.\s*<b>(.*?)<\/b>/i
    );

    const applicantName = applicantMatch
        ? cleanText(applicantMatch[1])
        : "";

    // Father Name
    const fatherMatch = html.match(
        /of\s*<b>(.*?)<\/b>/i
    );

    const fatherName = fatherMatch
        ? cleanText(fatherMatch[1])
        : "";

    // P/O
    const poMatch = html.match(
        /P\/O:\s*<b>(.*?)<\/b>/i
    );

    const po = poMatch
        ? cleanText(poMatch[1])
        : "";

    // Post Code
    const postCodeMatch = html.match(
        /Post Code:\s*<b>(.*?)<\/b>/i
    );

    const postCode = postCodeMatch
        ? cleanText(postCodeMatch[1])
        : "";

    // P/S
    const psMatch = html.match(
        /P\/S:\s*<b>(.*?)<\/b>/i
    );

    const ps = psMatch
        ? cleanText(psMatch[1])
        : "";

    // District
    const districtMatch = html.match(
        /District:\s*<b>(.*?)<\/b>/i
    );

    const district = districtMatch
        ? cleanText(districtMatch[1])
        : "";

    // Passport Number
    const passportMatch = html.match(
        /International Passport No\.\s*<b>(.*?)<\/b>/i
    );

    const passportNo = passportMatch
        ? cleanText(passportMatch[1])
        : "";

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


// PCC API
app.get("/api/pcc", async (req, res) => {

    try {

        const targetUrl = req.query.url;

        if (!targetUrl) {
            return res.status(400).json({
                success: false,
                message: "PCC URL is required"
            });
        }

        const parsedUrl = new URL(targetUrl);

        // Only official PCC website
        if (parsedUrl.hostname !== "pcc.police.gov.bd") {
            return res.status(400).json({
                success: false,
                message: "Invalid PCC website"
            });
        }

        // Get token
        let token = parsedUrl.searchParams.get("P50_TOKEN_ID");

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
        console.log("Token:", token);
        console.log("Connecting to PCC server...");
        console.log("======================================");

        const controller = new AbortController();

        const timeout = setTimeout(() => {
            controller.abort();
        }, 20000);

        const response = await fetch(targetUrl, {
            method: "GET",
            redirect: "follow",
            signal: controller.signal,
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36",

                "Accept":
                    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

                "Accept-Language":
                    "en-US,en;q=0.9"
            }
        });

        clearTimeout(timeout);

        console.log("HTTP STATUS:", response.status);
        console.log("FINAL URL:", response.url);

        if (!response.ok) {
            return res.status(502).json({
                success: false,
                message: "Official PCC server returned an error",
                status: response.status
            });
        }

        const html = await response.text();

        console.log("RESPONSE LENGTH:", html.length);

        const data = parsePCC(html, token);

        console.log("PCC DATA:");
        console.log(data);

        return res.json({
            success: true,
            data: data
        });

    } catch (error) {

        console.log("");
        console.log("PCC ERROR:");
        console.log(error);

        return res.status(500).json({
            success: false,
            message: "Official PCC page could not be read",
            error: error.message
        });
    }
});


// Health check
app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        message: "PCC Verify Server is running"
    });
});


// Start server
app.listen(PORT, () => {

    console.log("");
    console.log("======================================");
    console.log("PCC VERIFY SERVER RUNNING");
    console.log("Open: http://localhost:" + PORT);
    console.log("======================================");

});