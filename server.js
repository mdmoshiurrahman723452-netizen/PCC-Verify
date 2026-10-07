const express = require("express");
const https = require("https");

const app = express();

const PORT =
  process.env.PORT || 3000;


/* =========================
   STATIC FILES
========================= */

app.use(
  express.static(__dirname)
);


/* =========================
   HELPERS
========================= */

function cleanText(value) {

  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();

}


function stripHtml(value) {

  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();

}


/* =========================
   PCC PARSER
========================= */

function parsePCC(html, token) {

  const text =
    stripHtml(html);


  const result = {

    refNo:
      token || "",

    dated:
      "",

    applicantName:
      "",

    fatherName:
      "",

    po:
      "",

    postCode:
      "",

    ps:
      "",

    district:
      "",

    passportNo:
      ""

  };


  function findAfter(
    labels,
    maxLength = 150
  ) {

    for (
      const label of labels
    ) {

      const index =
        text
          .toUpperCase()
          .indexOf(
            label.toUpperCase()
          );

      if(index !== -1){

        const after =
          text.substring(
            index + label.length
          );

        const value =
          after
            .replace(
              /^[:\-\s]+/,
              ""
            )
            .split(
              /(?:PCC|POLICE|CLEARANCE|FATHER|PASSPORT|DISTRICT|POST|P\/O|P\/S)/i
            )[0]
            .trim();

        if(
          value &&
          value.length <= maxLength
        ){

          return value;

        }

      }

    }

    return "";

  }


  /* DATE */

  const dateMatch =
    text.match(
      /\b\d{1,2}[-\/](?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[-\/]\d{4}\b/i
    );


  if(dateMatch){

    result.dated =
      cleanText(
        dateMatch[0]
      );

  }else{

    const numericDate =
      text.match(
        /\b\d{1,2}[-\/]\d{1,2}[-\/]\d{4}\b/
      );

    if(numericDate){

      result.dated =
        cleanText(
          numericDate[0]
        );

    }

  }


  /* APPLICANT */

  result.applicantName =
    findAfter([
      "Applicant Name",
      "Applicant",
      "Name"
    ]);


  /* FATHER */

  result.fatherName =
    findAfter([
      "Father Name",
      "Father's Name",
      "Father"
    ]);


  /* P/O */

  result.po =
    findAfter([
      "P/O",
      "P.O.",
      "Post Office"
    ]);


  /* POST CODE */

  const postMatch =
    text.match(
      /(?:Post Code|Postal Code|Postcode)\s*[:\-]?\s*(\d{4,6})/i
    );

  if(postMatch){

    result.postCode =
      cleanText(
        postMatch[1]
      );

  }


  /* P/S */

  result.ps =
    findAfter([
      "P/S",
      "P.S.",
      "Police Station"
    ]);


  /* DISTRICT */

  result.district =
    findAfter([
      "District",
      "Jela",
      "Zila"
    ]);


  /* PASSPORT */

  const passportMatch =
    text.match(
      /(?:Passport\s*(?:No|Number)?|Passport)\s*[:\-]?\s*([A-Z0-9]{6,15})/i
    );

  if(passportMatch){

    result.passportNo =
      cleanText(
        passportMatch[1]
      );

  }


  return result;

}


/* =========================
   PCC HTTPS FALLBACK
========================= */

function fetchPCCWithHttps(url) {

  return new Promise(
    (resolve, reject) => {

      const request =
        https.get(
          url,
          {
            rejectUnauthorized:false,

            headers:{
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0 Safari/537.36",

              "Accept":
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

              "Accept-Language":
                "en-US,en;q=0.9"
            }
          },

          response => {

            let data = "";

            response.setEncoding(
              "utf8"
            );


            response.on(
              "data",
              chunk => {

                data += chunk;

              }
            );


            response.on(
              "end",
              () => {

                resolve({

                  statusCode:
                    response.statusCode,

                  finalUrl:
                    response.responseUrl ||
                    url,

                  body:
                    data

                });

              }
            );

          }
        );


      request.on(
        "error",
        reject
      );


      request.setTimeout(
        30000,
        () => {

          request.destroy(
            new Error(
              "PCC request timeout."
            )
          );

        }
      );

    }
  );

}


/* =========================
   PCC API
========================= */

app.get(
  "/api/pcc",
  async (req, res) => {

    const target =
      String(
        req.query.url || ""
      ).trim();


    if(!target){

      return res
        .status(400)
        .json({

          success:false,

          message:
            "PCC URL is required."

        });

    }


    let parsedUrl;


    try{

      parsedUrl =
        new URL(target);

    }catch(error){

      return res
        .status(400)
        .json({

          success:false,

          message:
            "Invalid PCC URL."

        });

    }


    if(
      parsedUrl.hostname !==
      "pcc.police.gov.bd"
    ){

      return res
        .status(403)
        .json({

          success:false,

          message:
            "Only official pcc.police.gov.bd URLs are allowed."

        });

    }


    const token =
      parsedUrl.searchParams.get(
        "P50_TOKEN_ID"
      );


    if(!token){

      return res
        .status(400)
        .json({

          success:false,

          message:
            "P50_TOKEN_ID not found."

        });

    }


    const startTime =
      Date.now();


    let html = "";
    let statusCode = 0;
    let finalUrl =
      target;


    /* =====================
       FIRST TRY:
       NATIVE FETCH
    ===================== */

    try{

      const controller =
        new AbortController();


      const timeout =
        setTimeout(
          () =>
            controller.abort(),
          30000
        );


      const response =
        await fetch(
          target,
          {
            method:"GET",

            headers:{

              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0 Safari/537.36",

              "Accept":
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

              "Accept-Language":
                "en-US,en;q=0.9",

              "Cache-Control":
                "no-cache",

              "Pragma":
                "no-cache"
            },

            redirect:"follow",

            signal:
              controller.signal
          }
        );


      clearTimeout(
        timeout
      );


      statusCode =
        response.status;


      finalUrl =
        response.url;


      html =
        await response.text();


  }catch(error){

    console.log(
      "Native fetch failed:",
      error.message
    );


    /* =====================
       FALLBACK HTTPS
    ===================== */

    try{

      const fallback =
        await fetchPCCWithHttps(
          target
        );


      statusCode =
        fallback.statusCode;


      finalUrl =
        fallback.finalUrl;


      html =
        fallback.body;


    }catch(fallbackError){

      return res
        .status(502)
        .json({

          success:false,

          message:
            "Render server could not connect to the official PCC website.",

          errorName:
            fallbackError.name,

          errorCode:
            fallbackError.code,

          cause:
            fallbackError.message

        });

    }

  }


  if(
    !html ||
    html.length < 100
  ){

    return res
      .status(502)
      .json({

        success:false,

        message:
          "Official PCC website returned empty response.",

        httpStatus:
          statusCode

      });

  }


  const data =
    parsePCC(
      html,
      token
    );


  const elapsedMs =
    Date.now() -
    startTime;


  return res.json({

    success:true,

    data:data,

    source:
      "pcc.police.gov.bd",

    finalUrl:
      finalUrl,

    httpStatus:
      statusCode,

    responseLength:
      html.length,

    elapsedMs:
      elapsedMs

  });

});


/* =========================
   WAFID OFFICIAL INFO API
========================= */

/*
  IMPORTANT:

  The official Wafid site currently exposes
  medical status search by Passport Number +
  Nationality.

  The public page does not expose a stable,
  documented JSON API endpoint that can safely
  be used here.

  Therefore this route does NOT fabricate
  FIT/UNFIT data.

  It simply gives the frontend the official
  Wafid URL.
*/

app.get(
  "/api/wafid",
  (req, res) => {

    const passport =
      String(
        req.query.passport || ""
      ).trim();


    if(!passport){

      return res
        .status(400)
        .json({

          success:false,

          message:
            "Passport number is required."

        });

    }


    return res.json({

      success:true,

      passport:
        passport,

      nationality:
        "Bangladesh",

      officialUrl:
        "https://wafid.com/en/medical-status-search/",

      message:
        "Use the official Wafid medical status search page to verify the result."

    });

  }
);


/* =========================
   HEALTH
========================= */

app.get(
  "/api/health",
  (req,res) => {

    res.json({

      success:true,

      message:
        "PCC Verify Server is running.",

      nodeVersion:
        process.version,

      port:
        String(PORT)

    });

  }
);


/* =========================
   TEST
========================= */

app.get(
  "/api/test",
  (req,res) => {

    res.json({

      success:true,

      message:
        "API is working.",

      time:
        new Date().toISOString()

    });

  }
);


/* =========================
   START SERVER
========================= */

app.listen(
  PORT,
  () => {

    console.log(
      `PCC Verify server running on port ${PORT}`
    );

  }
);
