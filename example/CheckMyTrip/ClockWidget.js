{
	elements: {
		field:	{ css: '#clock input[type=text]' },
		result:	{ css: '#clock .time-holder .time' }
	},
	
	lookup: function lookup(town) {
		this.field = town;
		this.field.sendKeys('\n');
		return this.field.submit();
	},

	getCurrentHour: function getCurrentHour() {
		return this.result
				   .getText()
				   .then(function(text) {
				    	var hour = text.split(':')[0];	// get the hour only
				    	return +hour;
				   });
	}
}
