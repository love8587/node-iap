var assert = require('assert');
var https = require('../https');

var apiUrls = {
	sandbox: 'https://sandbox.itunes.apple.com/verifyReceipt',
	production: 'https://buy.itunes.apple.com/verifyReceipt'
};

var responses = {
	'21000': 'The App Store could not read the JSON object you provided.',
	'21002': 'The data in the receipt-data property was malformed or missing.',
	'21003': 'The receipt could not be authenticated.',
	'21004': 'The shared secret you provided does not match the shared secret on file for your account.',
	'21005': 'The receipt server is not currently available.',
	'21006': 'This receipt is valid but the subscription has expired. When this status code is returned to your server, the receipt data is also decoded and returned as part of the response.',
	'21007': 'This receipt is from the test environment, but it was sent to the production service for verification. Send it to the test environment service instead.',
	'21008': 'This receipt is from the production receipt, but it was sent to the test environment service for verification. Send it to the production environment service instead.'
};


function getReceiptFieldValue(receipt, field) {
    var fieldValue = null;

    if (receipt.hasOwnProperty(field)) {
        fieldValue = receipt[field];
    }
		/* jshint camelcase:false */
    else if (receipt.hasOwnProperty('in_app') && receipt.in_app[0].hasOwnProperty(field)) {
        fieldValue = receipt.in_app[0][field];
    }
		/* jshint camelcase:true */
    return fieldValue;
}

function parseResult(result) {
	result = JSON.parse(result);

	var status = parseInt(result.status, 10);

	if (status !== 0) {
		var msg = responses[status] || 'Unknown status code: ' + status;

		var error = new Error(msg);
		error.status = status;

		throw error;
	}

	return {
		receipt: result.receipt,
		/* jshint camelcase:false */
		transactionId: getReceiptFieldValue(result.receipt, 'transaction_id'),
		productId: getReceiptFieldValue(result.receipt, 'product_id'),
		latestReceiptInfo: result.latest_receipt_info
		/* jshint camelcase:true */
	};
}

function verify(environmentUrl, options, cb) {
	https.post(environmentUrl, options, function (error, res, resultString) {
		if (error) {
			return cb(error);
		}

		if (res.statusCode !== 200) {
			return cb(new Error('Received ' + res.statusCode + ' status code with body: ' + resultString));
		}

		var resultObject;

		try {
			resultObject = parseResult(resultString);
		} catch (error) {
			return cb(error);
		}

		cb(null, resultObject);
	});
}


function isBase64like(str) {
	return !!str.match(/^[a-zA-Z0-9\/+]+\={0,2}$/);
}


exports.verifyPayment = function (payment, cb, sandbox) {
	var jsonData = {};

	try {
		assert.equal(typeof payment.receipt, 'string', 'Receipt must be a string');

		if (isBase64like(payment.receipt)) {
			jsonData['receipt-data'] = payment.receipt;
		} else {
			jsonData['receipt-data'] = (new Buffer(payment.receipt, 'utf8')).toString('base64');
		}
	} catch (error) {
		return process.nextTick(function () {
			cb(error);
		});
	}

	if (payment.secret !== undefined) {
		assert.equal(typeof payment.secret, 'string', 'Shared secret must be a string');
		jsonData.password = payment.secret;
	}

	function checkReceipt(error, result, environment) {
		if (error) {
			return cb(error);
		}

  	result.environment = environment;

		return cb(null, result);
	}

	var url = sandbox ? apiUrls.sandbox : apiUrls.production;
	verify(url, { json: jsonData }, function (error, resultString) {
		// 21007: this is a sandbox receipt, so take it there
		if (error && error.status === 21007) {
			return verify(apiUrls.sandbox, { json: jsonData }, function (err, res) {
			  checkReceipt(err, res, 'sandbox');
			});
		}

		return checkReceipt(error, resultString, 'production');
	});
};
