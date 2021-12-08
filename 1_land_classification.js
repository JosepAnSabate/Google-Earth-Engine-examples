/////////////////////////////////////////////////////////////////////////////////////
//Supervised Land Cover Classification of Cumberlabnd County, ME using Random Forest//
/////////////////////////////////////////////////////////////////////////////////////

////******Part 1: Adding imagery, filtering to area and date range, masking out clouds, and making a composite.******
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

//Insert Landsat Image Collection and filter by area using an imported shapefile
var image = ee.ImageCollection('LANDSAT/LC08/C01/T1_SR')
    .filterBounds(CCmaine);

//Function to cloud mask from the pixel_qa band of Landsat 8 SR data.
//Bits 3 and 5 are cloud shadow and cloud, respectively.
function maskL8sr(image) {
   var cloudShadowBitMask = 1 << 3;
   var cloudsBitMask = 1 << 5;

   var qa = image.select('pixel_qa');

  var mask = qa.bitwiseAnd(cloudShadowBitMask).eq(0)
       .and(qa.bitwiseAnd(cloudsBitMask).eq(0)); //applaying the mask, and assigning values o to the mask

   return image.updateMask(mask).divide(10000)
      .select("B[0-9]*")
      .copyProperties(image, ["system:time_start"]);
 }

//Filter imagery for 2019 and 2020 summer date ranges. 
//Create joint filter and apply it to Image Collection.
var sum20 = ee.Filter.date('2020-06-01','2020-09-30');
var sum19 = ee.Filter.date('2019-06-01','2020-09-30');

var SumFilter = ee.Filter.or(sum20, sum19);
var allsum = image.filter(SumFilter);

//Make a Composite: Apply the cloud mask function, use the median reducer, 
//and clip the composite to our area of interest
 var composite = allsum
               .map(maskL8sr)
               .median()
               .clip(CCmaine);

//Display the Composite
Map.addLayer(composite, {bands: ['B4','B3','B2'],min: 0, max: 0.3},'Cumberland Color Image', 0);

////******Part 2: Add Developed Land Data******
///////////////////////////////////////////////

//Add the impervious surface layer
 var impervious = ee.ImageCollection('USGS/NLCD')
                 .filterDate('2016-01-01', '2017-01-01')
                 .filterBounds(CCmaine)
                 .select('impervious') //selecting the lanc cover type
                 .map(function(image){return image.clip(CCmaine)});

//Reduce the image collection to 
 var reduced = impervious.reduce('median');

//Mask out the zero values in the data
 var masked = reduced.selfMask();

////******Part 3: Prepare for the Random Forest model******
////////////////////////////////////////////////

//// In this example, we use land cover classes: 
//// 1-100 = Percent Impervious Surfaces
//// 101 = coniferous  
//// 102 = mixed forest
//// 103 = deciduous
//// 104 = cultivated
//// 105 = water
//// 106 = cloud

//Merge land cover classifications into one feature class
 var newfc = coniferous.merge(mixedforest).merge(deciduous).merge(cultivated).merge(water);

//Specify the bands to use in the prediction.
 var bands = ['B3', 'B4', 'B5', 'B6', 'B7'];

//Make training data by 'overlaying' the points on the image.
 var points = composite.select(bands).sampleRegions({
   collection: newfc, 
   properties: ['landcover'], 
   scale: 30
 }).randomColumn(); // creates a column with random numbers

//Randomly split the samples to set some aside for testing the model's accuracy
//using the "random" column. Roughly 80% for training, 20% for testing.
 var split = 0.8;
 var training = points.filter(ee.Filter.lt('random', split));
 var testing = points.filter(ee.Filter.gte('random', split));

//Print these variables to see how much training and testing data you are using
print('Samples n =', points.aggregate_count('.all'));
print('Training n =', training.aggregate_count('.all'));
print('Testing n =', testing.aggregate_count('.all'));

//******Part 4: Random Forest Classification and Accuracy Assessments******
//////////////////////////////////////////////////////////////////////////

//Run the RF model using 300 trees and 5 randomly selected predictors per split ("(300,5)"). 
//Train using bands and land cover property and pull the land cover property from classes
 var classifier = ee.Classifier.smileRandomForest(300,5).train({ 
     features: training,
     classProperty: 'landcover',
     inputProperties: bands
 });

//Test the accuracy of the model
////////////////////////////////////////

//Print Confusion Matrix and Overall Accuracy
 var confusionMatrix = classifier.confusionMatrix();
 print('Confusion matrix: ', confusionMatrix);
 print('Training Overall Accuracy: ', confusionMatrix.accuracy());
 var kappa = confusionMatrix.kappa();
 print('Training Kappa', kappa);
 
 var validation = testing.classify(classifier);
 var testAccuracy = validation.errorMatrix('landcover', 'classification');
 print('Validation Error Matrix RF: ', testAccuracy);
 print('Validation Overall Accuracy RF: ', testAccuracy.accuracy());
 var kappa1 = testAccuracy.kappa();
 print('Validation Kappa', kappa1);

//Apply the trained classifier to the image
 var classified = composite.select(bands).classify(classifier);

////******Part 5:Create a legend******
//////////////////////////////////////

//Set position of panel
 var legend = ui.Panel({
   style: {
     position: 'bottom-left',
     padding: '8px 15px'
   }
 });
 
//Create legend title
 var legendTitle = ui.Label({
   value: 'Classification Legend',
   style: {
     fontWeight: 'bold',
     fontSize: '18px',
     margin: '0 0 4px 0',
     padding: '0'
     }
 });
 
//Add the title to the panel
 legend.add(legendTitle);
 
//Create and style 1 row of the legend.
 var makeRow = function(color, name) {
 
       var colorBox = ui.Label({
         style: {
           backgroundColor: '#' + color,
           padding: '8px',
           margin: '0 0 4px 0'
         }
       });
      
       var description = ui.Label({
         value: name,
         style: {margin: '0 0 4px 6px'}
       });
 
       return ui.Panel({
         widgets: [colorBox, description],
         layout: ui.Panel.Layout.Flow('horizontal')
       });
 };
 
//Identify palette with the legend colors
 var palette =['CCADE0', 'A052D3', '633581', '18620f', '3B953B','89CD89', 'EFE028', '0b4a8b'];
 
//Identify names within the legend
 var names = ['Low Density Development','Mid Density Development','High Density Development',
             'Coniferous','Mixed Forest','Deciduous','Cultivated','Water'];
 
//Add color and names
 for (var i = 0; i < 8; i++) {
   legend.add(makeRow(palette[i], names[i]));
   }  

//Add legend to map
 Map.add(legend);

////******Part 6: Display the Final Land Cover Classification and Provide Export Options******
//////////////////////////////////////////////////////////////////////////////////////////////

//Create palette for the final land cover map classifications
 var urbanPalette = 
 '<RasterSymbolizer>' +
 ' <ColorMap  type="intervals">' +
     '<ColorMapEntry color="#CCADE0" quantity="22" label="Low Density Development"/>' +
     '<ColorMapEntry color="#A052D3" quantity="56" label="Mid Density Development"/>' +
    '<ColorMapEntry color="#633581" quantity="100" label="High Density Development"/>' +
     '<ColorMapEntry color="#18620f" quantity="101" label="Coniferous"/>' +
     '<ColorMapEntry color="#3B953B" quantity="102" label="Mixed Forest"/>' +
     '<ColorMapEntry color="#89CD89" quantity="103" label="Deciduous"/>' +
     '<ColorMapEntry color="#EFE028" quantity="104" label="Cultivated"/>' +
     '<ColorMapEntry color="#0b4a8b" quantity="105" label="Water"/>' +
   '</ColorMap>' +
 '</RasterSymbolizer>';

//Mask out impervious surfaces
// https://developers.google.com/earth-engine/apidocs/ee-image-blend
 var finalmap = classified.blend(masked); //Overlays one image on top of another. 

//Add final map to the display
 Map.addLayer(finalmap.sldStyle(urbanPalette), {}, "Land Classification");

//Center the map for display
 Map.setCenter(-70.3322, 43.8398, 10);
