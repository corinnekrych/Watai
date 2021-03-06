var TestRight = require('../helpers/subject'),
	my = require('../helpers/driver').getDriverHolder(),
	subject,
	elements,
	expectedTexts;


/** Widget description of elements existing in the “checking” part of the test support page resource.
* These elements have their content updated according to actions made on the “main” elements described above.
*@private
*/
var checkerElements = {
	p3Clicked:	{ id: 'clickedLink' }
}


/** This test suite is written with [Mocha](http://visionmedia.github.com/mocha/) and [Should](https://github.com/visionmedia/should.js).
*/
describe('Widget', function() {
	before(function() {
		var testWidget = require('../helpers/testWidget');
		elements = testWidget.elements;
		expectedTexts = testWidget.expectedTexts;
		subject = testWidget.getWidget(my.driver);
	});

	describe('parsing', function() {
		it('should add all elements as properties', function() {
			for (var key in elements)
				if (elements.hasOwnProperty(key)
					&& key != 'missing') {	// Should.js' property checker accesses the property, which would therefore make the missing element throw because it is unreachable
					subject.should.have.property(key);
					subject[key].should.be.a('object');
				}
		});
		
		it('should bind methods properly', function(done) {
			subject.submit('something');
			
			subject.field.getAttribute('value').then(function(value) {
				value.should.equal('Default');	// because the page has been reloaded
				done();
			});
		});
		
		it('should do some magic on *Link names', function() {
			subject.should.have.property('p3');
			subject.p3.should.be.a('function');	// on 'link', this should be a shortcut to clicking the element, not a simple access
		});
	});
	
	describe('element access', function() {
		var checker;

		before(function() {
			checker = new TestRight.Widget('Events results widget', {
				elements: checkerElements
			}, my.driver);
		});
	
		it('should map elements to hooks', function(done) {
			subject.id.getText().then(function(text) {
				text.should.equal(expectedTexts.id);
				done();
			});
		});
		
		it('should say that an existing element is present', function(done) {
			subject.has('id').then(function(presence) {
				presence.should.be.ok;
				done();
			});
		});
		
		it('should say that a missing element is not present', function(done) {
			this.timeout(6 * 1000);	// since this raises an error, the Selenium server lags the first time
			
			subject.has('missing').then(function(presence) {
				presence.should.not.be.ok;
				done();
			});
		});
	
		xit('should fail promises if an unreachable element is accessed', function(done) {
			subject.missing.getText().then(function() {	//TODO
				done(new Error('Resolved instead of rejected!'));
			}, function(error) {
				done();
			});
		});
		
		it('should bind magically created link methods to clicking', function(done) {
			subject.p3();
			checker.p3Clicked.getText().then(function(text) {
				text.should.equal('#link has been clicked');
				done();
			});
		});
	});
});
