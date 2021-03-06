var promises = require('q'),
	assert = require('assert');
	
var logger = require('winston').loggers.get('steps');


var Feature = new Class( /** @lends Feature# */ {
	/** A sequence of promises to be executed in order, constructed after the scenario for this feature.
	*@private
	*/
	steps: [],
	
	/** A hash with all widgets accessible to this Feature, indexed on their names.
	*@type	{Object.<String, Widget>}
	*@see	Widget
	*@private
	*/
	widgets: {},
	
	/**@class	A Feature models a sequence of actions to be executed through Widgets.
	* 
	* A feature description file contains a simple descriptive array listing widget methods to execute and widget state descriptors to assert.
	* More formally, such an array is ordered and its members may be:
	* - a closure;
	* - an object whose keys are some widgets' attributes identifiers (ex: "MyWidget.myAttr"), pointing at a string that contains the expected text content of the HTML element represented by the `myAttr` hook in `MyWidget`.
	*
	* Upon instantiation, a Feature translates this array into an array of promises:
	* - closures are executed directly, either as promises if they are so themselves, or as basic functions;
	* - a widget state describing hash maps each of its members to an assertion inside a promise, evaluating all of them asynchronously.
	* All those promises are then evaluated sequentially upon calling the `test` method of a Feature.
	*
	*@constructs
	*@param	{String}	description	A plain text description of the feature, advised to be written in a BDD fashion.
	*@param	{Array}		scenario	An array that describes states and transitions. See class documentation for formatting.
	*@param	{Object.<String, Widget>}	widgets	A hash listing all widgets accessible to this Feature, indexed on their names.
	*/
	initialize: function init(description, scenario, widgets) {
		this.description = description;
		
		this.widgets = widgets;	//TODO: transform so that they can be referred to with the "Widget" suffix optional?
		
		this.steps = this.loadScenario(scenario);
	},
	
	/** Parses an array that describes states and transitions and transforms it into a sequence of promises to be evaluated.
	*
	*@param		{Array}	scenario	An array that describes states and transitions. See class documentation for formatting.
	*@returns	{Array.<function>}	An array of promises representing the given scenario.
	*@private
	*/
	loadScenario: function loadScenario(scenario) {
		var result = [];
		
		for (var stepIndex = 0; stepIndex < scenario.length; stepIndex++) {
			var step = scenario[stepIndex]; // takes all values listed in a scenario
			
			/* So, this is going to be a bit hard. Stay with me  ;)
			 * Scenarios are loaded in a different context, absolutely clean by default (see SuiteLoader).
			 * Therefore, steps in the scenario are clean of any prototype augmentation.
			 * MooTools, for example, allows proper type introspection through prototype augmentation. This is not usable here.
			 * But we still need to do introspection to offer proper heuristics. Tricks to achieve this are below.
			 */
			result.push(	typeof step == 'function' ?
							step
						  : typeof step == 'object' && step.length >= 0 ?	// an Array has a length property, not an Object; as a consequence, `length` is a reserved property for state description hashes
						    this.buildFunctionalPromise(result.pop(), step)
						  : typeof step == 'object' ?
						    this.buildAssertionPromise(step) // if this is a Hash, it is a description value
						  : this.buildFunctionalPromise(result.pop(), [ step ])	// default: this is a primitive value, we normalize it by wrapping
						);
		}
		
		return result;
	},
	
	/** Normalizes an operational closure (i.e. a function that modifies a widget's state) to a format compatible with scenario steps execution.
	*
	*@param	{Function}	func	The raw function to execute.
	*@param	{Array}		params	Parameters to bind to this function.
	*@returns	{Function}	A bound function, ready for execution as a step.
	*@private
	*/
	buildFunctionalPromise: function buildFunctionalPromise(func, params) {
		return func.apply.bind(func, null, params);
	},
	
	/** Parses a widget state description and creates an assertive closure returning the promise for assertions results upon evaluation.
	*
	*@param		{Object}	hooksVals	A hash whose keys match some widgets' attributes, pointing at values that are expected values for those attributes.
	*@returns	{function}	A parameter-less closure asserting the described state and returning a promise that will be either:
	*	- rejected if any assertion fails, passing a string parameter that describes the first failed match;
	*	- resolved if all assertions pass, with no parameter.
	*@private
	*/
	buildAssertionPromise: function buildAssertionPromise(hooksVals) {
		var widgets = this.widgets,	// making the closure complete for later evaluation
			matchesLeft = 0;	// optimization: we're using the check loop beneath to cache the count of elements to match
		
		Object.each(hooksVals, function(expected, attribute) {
			matchesLeft++;

			if (! Object.hasPropertyPath(widgets, attribute)) {	// unfortunately, we can't cache this, since WebDriverJS matches elements to the current page once and for all. We'll have to ask access on the page on which the assertion will take place.
				logger.error('Could not find "' + attribute + '" in available widgets. Are you sure you spelled the property path properly?', { widgets: widgets });
				throw new Error('Could not find "' + attribute + '" in available widgets');
			}
		});
		
		return function() {
			var evaluator = promises.defer();

			var isEmpty = true;	// yep, we have to treat the special case of {}

			Object.each(hooksVals, function(expected, attribute) {
				isEmpty = false;

				function compareTo(actual) {
					if (expected != actual)
						evaluator.reject(attribute + ' was "' + actual + '" instead of "' + expected + '"');
					
					if (--matchesLeft == 0)
						evaluator.resolve();
				}

				Object.getFromPath(widgets, attribute).then(function(target) {
						target.getText().then(function(text) {
							if (text) {	//TODO: refactor to use an array of methods to check sequentially
								compareTo(text);
							} else {	// it could be that it is an input field and we need to compare the value
								target.getAttribute('value')
									  .then(compareTo,
											evaluator.reject.bind(evaluator, 'Could not get value from element "' + attribute + '".'));
							}
						},
						evaluator.reject.bind(evaluator, 'Could not get text from element "' + attribute + '".'));
					},
					function() {
						evaluator.reject('Element "' + attribute + '" does not exist on the page.'); // direct binding makes webdriverjs throw the reason for rejection again :/
					}
				)
			});

			if (isEmpty)
				evaluator.resolve();
			
			return evaluator.promise;
		}
	},
	
	/** Asynchronously evaluates the scenario given to this feature.
	*
	*@returns	{Promise}	A promise that will be either:
	*	- rejected if any assertion or action fails, passing a hash containing two keys:
	*		• `failures`: an array of strings that describe reason(s) for failure(s) (one reason per item in the array);
	*		• `errors`: an array of strings that describe errors that arose when trying to evaluate the feature.
	*	- resolved if all assertions pass, with no parameter.
	*/
	test: function evaluate() {
		var deferred = promises.defer(),
			stepIndex = -1;
		
		var evaluateNext,
			failureReasons = {
				failures: [],	// we differentiate between the two types
				errors: []
			};
		
		var handleFailure = function handleFailure(message) {
			failureReasons.failures.push(message);
			evaluateNext();
		}

		function fulfillPromise(report) {
			if (report.failures.length || report.errors.length)
				return deferred.reject(report);
			else
				return deferred.resolve();
		}
		
		evaluateNext = (function evalNext() {
			stepIndex++;

			if (stepIndex == this.steps.length)
				return fulfillPromise(failureReasons);
			
			try {
				var result = this.steps[stepIndex]();
				// unfortunately, [q.when](https://github.com/kriskowal/q#the-middle) is not compatible with WebDriver's Promises/A implementation, and we need to explicitly call `then` to reject thrown exceptions
				if (result && typeof result.then == 'function')
					result.then(evaluateNext, handleFailure);
				else
					evaluateNext();

			} catch (error) {
				failureReasons.errors.push(error);
				evaluateNext();
			}
		}).bind(this);
		
		evaluateNext();	//TODO: make async
		
		return deferred.promise;
	}
});


module.exports = Feature;	// CommonJS export
