# Catchment Characteristics of Swedish National Monitoring Lakes

This dataset contains data for catchment characteristics and lake water chemistry data for lakes in the [SLS](https://www.havochvatten.se/overvakning-och-uppfoljning/miljoovervakning/organisation-och-programomraden/miljoovervakningens-programomrade-sotvatten/delprogram-omdrevsstationer-sjoar.html) and [trend lake](https://www.havochvatten.se/overvakning-och-uppfoljning/miljoovervakning/organisation-och-programomraden/miljoovervakningens-programomrade-sotvatten/delprogram-trendstationer-sjoar.html) monitoring programs.

The dataset and a description of the available variables can be found in the data section (data files and readme_data.md).

The exact code used to create the dataset is located in git_freeze and described in readme_code.md. A live updated version of the code can be found at this git repository: [aalackner/DOC_catchments/pupdata](https://github.com/aalackner/DOC_catchments/).


**How to cite**: 

Lackner, A. (2026). Catchment characteristics and water chemistry of over 5000 nationally monitored Swedish lakes (Version 1) [Data set]. Swedish University of Agricultural Sciences. Available at: https://doi.org/10.5878/85cj-nv56



## Short Overview:

### [Swedish Lake survey](https://www.havochvatten.se/overvakning-och-uppfoljning/miljoovervakning/organisation-och-programomraden/miljoovervakningens-programomrade-sotvatten/delprogram-omdrevsstationer-sjoar.html#query/Delprogram%20Trendstationer%20sj%C3%B6ar)

The Swedish Lake Survey, in Swedish the 'Delprogram Omdrevsstationer sjöar', is a water chemistry monitoring program, that has been running since 2007. 4800 lakes were selected out of Sweden's  95 700 lakes with an area > 1ha. In addition regional monitoring programs have added additional randomly selected lakes, increasing the total number of lakes sampled within this framework to 6230. 800 of these lakes are sampled every year, returning to the same lakes every 6 years. The aim of this program was to capture the overall state of water chemistry in Swedish lakes over the whole country.  

The lakes are sampled in the center of the lake at 0.5 m depth, in the autumn (September - December) during autumn turn-over. 


The [Department of Aquatic Sciences and Assessment](https://www.slu.se/en/about-slu/organisation/departments/aquatic-sciences/environment/subprograms/cyclically-low-intensity-monitored-lakes/) is responsible for the sampling this monitoring program and all the data available at the [MVM database](https://miljodata.slu.se/mvm/).

### [Swedish trend lakes](https://www.havochvatten.se/overvakning-och-uppfoljning/miljoovervakning/organisation-och-programomraden/miljoovervakningens-programomrade-sotvatten/delprogram-trendstationer-sjoar.html)

The Swedish trend lakes, in Swedish the 'Delprogram Trendstationer sjöar', is a lake monitoring program, that has been running for over 40 years. As of 2024 there are 107 lakes in the program, sampled seasonally (4 times / year) for water chemistry and at least yearly for biological parameters. The lakes were selected based on limited point source and intensive land use impacts.  The objective of the programme is to provide a representative picture of the state and large-scale changes in small to medium-sized Swedish lakes that are not affected by local/regional emissions or intensive land use. 

The lakes range from 0.02 - 52.6 km2. The lakes are sampled in the center of the lake at 0.5 m depth, in the autumn (September - December) during autumn turn-over. 


The [Department of Aquatic Sciences and Assessment](https://www.slu.se/en/about-slu/organisation/departments/aquatic-sciences/environment/subprograms/trend-lakes/) is responsible for the sampling this monitoring program and all the data available at the [MVM database](https://miljodata.slu.se/mvm/).



## Files

This dataset includes data as well as the code used to produce this data. There are therefore two more readme files, one describing the data more closely, readme_data.md and one describing the code more closely, readme_code.md.

### Data

There are 7 main files, and a compilation of intermediary data where time series were produced and then summarized for the final datasets.



Two csv files with water chemistry data for the trend and SLS monitoring program downloaded from MVM database and preprocessed.

1. **chemistry_SLS.csv**  14107 x 46,  4.8MB
2. **chemistry_trend.csv**  16018 x 46,  5.1MB



Three csv files containing summarized catchment characteristics for the lakes in the SLS and trend monitoring programs, p-values for the slope estimators of the characteristics_SLS.csv

3. **characteristics_SLS.csv** 5030 x 81,  6MB
4. **characteristics_trend.csv** 107 x 93,  0.16MB
5. **significance.csv** 5137 × 27, 1.21 MB

These include information on land use,vegetation dynamics, climate, atmospheric deposition, water chemistry, and elevation. A full description of these parameters can be found in the readme_data.md accompanying the files. P-values for the calculation of slope estimators from _change variables in file 3. and 4. can be found in file 5. (significance.csv). 


In addition, 2 zip folders with shapefiles are included. These are the catchment delineations used for extraction of these catchments.

6. **SLS.zip** 6194 polygons, 20MB
7. **trend.zip** 110 polygons, 0.3MB

In addition, there is a etc.zip  file (114MB) which includes intermediate outputs, such as timeseries of climate, deposition, and runoff data. 

___

author: Anna Lackner anna.lackner@slu.se

date: 13/05/2026

