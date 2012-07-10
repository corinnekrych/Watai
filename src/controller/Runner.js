var webdriver = require('selenium-webdriverjs');
var growl;
try {
	growl = require('growl');
} catch (e) {
	growl = false;
}
	

/**@class Manages a set of features and the driver in which they are run.
*
* A `Runner` is mostly set up through a configuration object.
* Such an object should contain the following items:
*	- `baseURL`: the URL at which the driver should start;
*	- `driverCapabilities`: an object that will be passed straight to the WebDriver instance.
*
* The chosen implementation for WebDriver is the [official WebDriverJS](https://code.google.com/p/selenium/wiki/WebDriverJs) by the Selenium team. Make sure you use this module and not one of the other implementations, since this code has not been tested with any other.
*/
var Runner = new Class({
	/** Whether any test did fail during the current run or not.
	*@type	{boolean}
	*@private
	*/
	failed: false,
	
	/** The list of all features to evaluate with this configuration.
	*@type	{Array.<Feature>}
	*@private
	*/
	features: [],
	
	/** Winston logger to use to log features acceptation or rejection, and potential errors.
	*@type	winston.Logger
	*@private
	*/
	logger: null,
	
	/** Index of the currently evaluated feature.
	*@type	{integer}
	*@private
	*/
	currentFeature: 0,

	/** A runner is set up by passing it a configuration object.
	*
	*@param	{Object}	config	A configuration object, as defined above.
	*@param	{winston.Logger=}	[logger=default Winston logger]	The logger to use to send feature evaluation results. If not provided, will use the default Winston logger.
	*
	*@see	WebDriver.Builder#withCapabilities
	*@see	https://github.com/flatiron/winston#using-the-default-logger
	*/
	initialize: function init(config, logger) {
		this.config = config;
		this.logger = logger || require('winston');
		
		this.driver = new webdriver.Builder()
						.usingServer('http://127.0.0.1:4444/wd/hub')	//TODO: extract connect URL and put it in config
						.withCapabilities(config.driverCapabilities)
						.build();
						
		DRIVER = this.driver;
	},
	
	/** Adds the given Feature to the list of those that this Runner will evaluate.
	*
	*@param	{Feature}	feature	A Feature for this Runner to evaluate.
	*@returns	This Runner, for chaining.
	*/
	addFeature: function addFeature(feature) {
		this.features.push(feature);
		
		return this;
	},
	
	/** Returns the WebDriver instance this Runner created for the current run.
	*
	*@returns	WebDriver
	*/
	getDriver: function getDriver() {
		return this.driver;
	},
	
	/** Starts evaluation of all features added to this Runner.
	*
	*@returns	{Runner}	This Runner, for chainability.
	*/
	//TODO: should return a promise for results
	run: function run() {
		this.failed = false;
		this.currentFeature = 0;
		
		var runner = this;		
		this.driver.get(this.config.baseURL).then(function() {
			runner.evaluateFeature(runner.features[0]);
		}, function() {	//TODO: this function is never called?!
			runner.logger.error('The Selenium server could not be reached!');
			runner.logger.debug('Did you start it up?');
			runner.logger.debug('See the troubleshooting guide if you need help  ;)');
			runner.finish(false);
		});
		
		return this;
	},
	
	/** Prepares and triggers the evaluation of the given feature.
	*
	*@private
	*/
	evaluateFeature: function evaluateFeature(feature) {
		try {
			feature.test().then(this.handleFeatureResult.bind(this, feature, true),
								this.handleFeatureResult.bind(this, feature)); // leave last arg to pass failure description
		} catch (error) {
			this.logger.error(error);
			this.finish(false);	//TODO: make it possible to continue even if an error is encountered?
		}
	},
	
	/** Callback handler upon feature evaluation.
	* Displays result, errors if there were any, and calls the `postFeature` handler.
	*
	*@param	{Feature}	feature	The feature for which the result is to be presented.
	*@param	{Error|boolean}	message	Either a failure description message or `true` if the feature was a success.
	*@private
	*@see	#postFeature
	*/
	handleFeatureResult: function handleFeatureResult(feature, message) {
		if (message === true) {
			this.logger.info('✔	' + feature.description);
		} else {
			this.logger.warn('✘	' + feature.description);
			this.logger.debug('	' + message);
			this.failed = true;
		}
		
		this.postFeature();
	},
	
	/** Increments the feature index, starts evaluation of the next feature, and quits the driver if all features were evaluated.
	*
	*@private
	*/
	postFeature: function postFeature() {
		this.currentFeature++;
		
		if (this.currentFeature < this.features.length)
			this.evaluateFeature(this.features[this.currentFeature]);
		else
			this.finish(! this.failed);
	},
	
	/** Informs the user of the end result and cleans up everything after tests runs.
	*
	*@param	{Boolean}	success	Whether all features succeeded or not.
	*@private
	*/	
	finish: function finish(success) {
		var message = 'Test ' + (success ? 'succeeded  :)' : 'failed  :('),
			loggingMethod = (success ? 'info' : 'warn');
			
		this.logger[loggingMethod](message);
		if (growl)
			growl(message);
		
		if (this.driver)
			this.driver.quit();
	}
});

module.exports = Runner;	// CommonJS export
